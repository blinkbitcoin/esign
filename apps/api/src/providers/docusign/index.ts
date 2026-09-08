// DocuSign adapter: implements the ESignProvider port over the
// @blinkbitcoin/esign-server client (JWT auth, envelopes, Web Forms), the
// status/webhook mapping (mapping.ts) and the service config (config.ts).
// This file is intentionally thin - the DocuSign plumbing lives in the
// package, so a host that runs its own backend gets the same code.

import {
  createDocuSignClient,
  type DocuSignClient,
  isClientError,
  isNotFoundError,
  createWebFormInstance as mintWebFormInstance,
  withRetry,
} from '@blinkbitcoin/esign-server';
import { Errors } from '../../errors';
import type {
  EnvelopeResult,
  EnvelopeStatus,
  RecipientData,
  SigningUrlResult,
  WebFormInstanceResult,
  WebFormPrefill,
  WebhookEvent,
  WebhookHeaders,
} from '../../types';
import { validateHmac } from '../../webhook';
import type { ESignProvider } from '../port';
import { getConfig } from './config';
import type { DocuSignWebhookPayload } from './mapping';
import { mapDocuSignStatus, mapWebhookStatus } from './mapping';

// One client (and token cache) per process, built from the environment on
// first use; clearTokenCache drops it (tests, credential rotation)
let client: DocuSignClient | null = null;
const getClient = (): DocuSignClient => {
  if (!client) {
    client = createDocuSignClient(getConfig());
  }
  return client;
};

// Forget the client and its cached token
export const clearTokenCache = (): void => {
  client = null;
};

export const DocuSignProvider: ESignProvider = {
  async createEnvelope(
    _userId: string,
    _contractType: string,
    recipient: RecipientData
  ): Promise<EnvelopeResult> {
    try {
      const docusign = getClient();
      const envelope = await withRetry(() => docusign.createEnvelopeFromTemplate(recipient));
      const signingUrl = await withRetry(() =>
        docusign.getEmbeddedSigningUrl(envelope.envelopeId, recipient)
      );
      return { envelopeId: envelope.envelopeId, signingUrl };
    } catch (error) {
      // 4xx (excluding rate limits) indicate validation/client errors
      if (isClientError(error)) {
        throw Errors.envelopeCreationFailed();
      }
      // All other errors (after retries) indicate service unavailability
      throw Errors.providerUnavailable();
    }
  },

  async getEnvelopeStatus(envelopeId: string): Promise<EnvelopeStatus> {
    try {
      const response = await withRetry(() => getClient().fetchEnvelopeStatus(envelopeId));
      return mapDocuSignStatus(response.status);
    } catch (error) {
      if (isNotFoundError(error)) {
        throw Errors.envelopeNotFound();
      }
      throw Errors.providerUnavailable();
    }
  },

  // New signing URL for an existing envelope (session restart)
  async getSigningUrl(envelopeId: string, recipient: RecipientData): Promise<SigningUrlResult> {
    try {
      const signingUrl = await withRetry(() =>
        getClient().getEmbeddedSigningUrl(envelopeId, recipient)
      );
      return { signingUrl };
    } catch (error) {
      // Any non-retryable client error (including 404) maps to "not found" -
      // don't leak provider-side details about why the envelope was rejected
      if (isClientError(error)) {
        throw Errors.envelopeNotFound();
      }
      throw Errors.providerUnavailable();
    }
  },

  // Verify a DocuSign Connect webhook: HMAC-SHA256 over the raw body, delivered
  // in the X-DocuSign-Signature-1 header, keyed by DOCUSIGN_HMAC_KEY.
  verifyWebhook(headers: WebhookHeaders, rawBody: string, ip?: string): boolean {
    const headerValue = headers['x-docusign-signature-1'];
    const signature = typeof headerValue === 'string' ? headerValue : undefined;
    return validateHmac(signature, rawBody, process.env.DOCUSIGN_HMAC_KEY, ip);
  },

  // Parse a DocuSign Connect payload into a normalized webhook event.
  // Returns null for malformed payloads (invalid JSON or missing fields).
  parseWebhookEvent(rawBody: string): WebhookEvent | null {
    let payload: DocuSignWebhookPayload;
    try {
      payload = JSON.parse(rawBody) as DocuSignWebhookPayload;
    } catch {
      return null;
    }

    const providerEnvelopeId = payload.data?.envelopeId;
    const rawStatus = payload.data?.envelopeSummary?.status;
    if (!providerEnvelopeId || !rawStatus) {
      return null;
    }

    return {
      providerEnvelopeId,
      rawStatus,
      status: mapWebhookStatus(rawStatus),
    };
  },

  // Create a prefilled DocuSign Web Forms instance (form-based signing).
  // Requires DOCUSIGN_WEBFORM_ID (+ the standard JWT config). The instance
  // carries the service's return-URL bridge, so a plain WebView/iframe host
  // gets the outcome without DocuSign.js. Errors map like createEnvelope:
  // 4xx → creation failed, else unavailable.
  async createWebFormInstance(
    userId: string,
    prefill: WebFormPrefill
  ): Promise<WebFormInstanceResult> {
    if (!getConfig().webFormId) {
      throw Errors.validationError('DOCUSIGN_WEBFORM_ID is not configured');
    }
    try {
      return await mintWebFormInstance({ client: getClient(), userId, prefill });
    } catch (error) {
      if (isClientError(error)) {
        throw Errors.envelopeCreationFailed();
      }
      throw Errors.providerUnavailable();
    }
  },
};

// Re-exports: the package's testable utilities (imported by tests), config
// validation (used by the factory) and the webhook payload type.
export {
  HttpError,
  RETRY_CONFIG,
  shouldRetry,
  sleep,
  withRetry,
} from '@blinkbitcoin/esign-server';
export { validateConfig } from './config';
export type { DocuSignWebhookPayload } from './mapping';
