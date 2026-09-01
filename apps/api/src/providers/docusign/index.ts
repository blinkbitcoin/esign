// DocuSign adapter: implements the ESignProvider port by composing the DocuSign
// HTTP client (client.ts), status/webhook mapping (mapping.ts), and config
// (config.ts). This file is intentionally thin - all DocuSign plumbing lives in
// the sibling modules.

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
import {
  createEnvelopeFromTemplate,
  createWebFormInstanceRequest,
  fetchEnvelopeStatus,
  getAccessToken,
  getEmbeddedSigningUrl,
  isClientError,
  isNotFoundError,
  withRetry,
} from './client';
import { getConfig } from './config';
import type { DocuSignWebhookPayload } from './mapping';
import { mapDocuSignStatus, mapWebhookStatus } from './mapping';

export const DocuSignProvider: ESignProvider = {
  async createEnvelope(
    _userId: string,
    _contractType: string,
    recipient: RecipientData
  ): Promise<EnvelopeResult> {
    try {
      const accessToken = await withRetry(() => getAccessToken());
      const envelope = await withRetry(() => createEnvelopeFromTemplate(accessToken, recipient));
      const signingUrl = await withRetry(() =>
        getEmbeddedSigningUrl(accessToken, envelope.envelopeId, recipient)
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
      const accessToken = await withRetry(() => getAccessToken());
      const response = await withRetry(() => fetchEnvelopeStatus(accessToken, envelopeId));
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
      const accessToken = await withRetry(() => getAccessToken());
      const signingUrl = await withRetry(() =>
        getEmbeddedSigningUrl(accessToken, envelopeId, recipient)
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
  // Requires DOCUSIGN_WEBFORM_ID (+ the standard JWT config). Errors map like
  // createEnvelope: 4xx → creation failed, else unavailable.
  async createWebFormInstance(
    userId: string,
    prefill: WebFormPrefill
  ): Promise<WebFormInstanceResult> {
    if (!getConfig().webFormId) {
      throw Errors.validationError('DOCUSIGN_WEBFORM_ID is not configured');
    }
    try {
      const accessToken = await withRetry(() => getAccessToken());
      // The authenticated app user is the clientUserId (required by DocuSign,
      // identifies the form submitter); truncate to the 100-char limit.
      const clientUserId = userId.slice(0, 100);
      return await withRetry(() =>
        createWebFormInstanceRequest(accessToken, clientUserId, prefill)
      );
    } catch (error) {
      if (isClientError(error)) {
        throw Errors.envelopeCreationFailed();
      }
      throw Errors.providerUnavailable();
    }
  },
};

export { clearTokenCache, HttpError, RETRY_CONFIG, shouldRetry, sleep, withRetry } from './client';
// Re-exports: config validation (used by the factory) and the client's testable
// utilities + the webhook payload type (imported by tests).
export { validateConfig } from './config';
export type { DocuSignWebhookPayload } from './mapping';
