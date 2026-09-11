// The DocuSign adapter: implements the ESignProvider port over the client,
// maps DocuSign statuses and Connect webhooks onto the normalized vocabulary.

import { Errors } from '../../errors';
import { validateHmac } from '../../hmac';
import { isClientError, isNotFoundError, withRetry } from '../../http';
import type { Logger } from '../../log';
import type { ESignProvider } from '../../provider';
import type {
  EnvelopePrefill,
  EnvelopeResult,
  EnvelopeStatus,
  HostedFormInstanceResult,
  RecipientData,
  SigningUrlResult,
  WebFormPrefill,
  WebhookEvent,
  WebhookHeaders,
} from '../../types';
import { createDocuSignClient, type DocuSignClient } from './client';
import {
  assertDocuSignConfig,
  type DocuSignConfig,
  DocuSignConfigError,
} from './config';
import { assertEnvelopePrefill, PrefillError } from './prefill';
import { createWebFormInstance } from './webforms';

// --- Status + webhook mapping -----------------------------------------------

// DocuSign envelope status (status polling) → normalized. Unknowns default
// to 'sent' (the envelope exists and is not finished as far as we know).
export const mapDocuSignStatus = (status: string): EnvelopeStatus => {
  switch (status.toLowerCase()) {
    case 'sent':
    case 'delivered':
      return 'sent';
    case 'completed':
    case 'signed':
      return 'completed';
    case 'voided':
      return 'voided';
    case 'declined':
      return 'declined';
    default:
      return 'sent';
  }
};

// DocuSign Connect webhook payload (per DocuSign Connect docs)
export interface DocuSignWebhookPayload {
  event: string; // e.g. "envelope-completed"
  apiVersion: string;
  uri: string;
  retryCount: number;
  configurationId: number;
  generatedDateTime: string;
  data: {
    accountId: string;
    userId: string;
    envelopeId: string; // DocuSign's envelope ID (our provider envelope ID)
    envelopeSummary: {
      status: string; // "completed", "declined", "voided", "sent", ...
      emailSubject: string;
    };
  };
}

// Connect webhook status → normalized; unknowns map to null and the event is
// ignored (unlike the polling map, which defaults to 'sent')
export const mapWebhookStatus = (
  docusignStatus: string,
): EnvelopeStatus | null => {
  const statusMap: Record<string, EnvelopeStatus> = {
    completed: 'completed',
    declined: 'declined',
    voided: 'voided',
    sent: 'sent',
  };
  return statusMap[docusignStatus.toLowerCase()] || null;
};

// Parse a Connect payload into a normalized event; null when malformed
export const parseDocuSignWebhook = (rawBody: string): WebhookEvent | null => {
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
  return { providerEnvelopeId, rawStatus, status: mapWebhookStatus(rawStatus) };
};

// The Connect signature header
export const DOCUSIGN_SIGNATURE_HEADER = 'x-docusign-signature-1';

// --- Adapter -----------------------------------------------------------------

export interface DocuSignWebhookOptions {
  // The Connect HMAC key (read per call, so rotation and tests see changes)
  hmacKey: () => string | undefined;
  // Allow unsigned webhooks when no key is configured (local dev only)
  allowMissingKey?: () => boolean;
  logger?: Logger;
}

export interface DocuSignProviderOptions {
  // The configuration, or a getter read on each client (re)creation
  config: DocuSignConfig | (() => DocuSignConfig);
  webhook: DocuSignWebhookOptions;
  // Client factory (tests inject fetch through it)
  createClient?: (config: DocuSignConfig) => DocuSignClient;
}

export interface DocuSignProviderHandle extends ESignProvider {
  // Drop the client and its token cache (tests, credential rotation)
  reset(): void;
}

// What creating an envelope or minting a form instance reports when it fails:
// a prefill outside the contract, or a setting the operation needs, is the
// caller's error, not the provider's; 4xx (excluding rate limits) are
// validation/client errors; anything else (after retries) means the service
// is unavailable.
const creationError = (error: unknown): Error => {
  if (error instanceof PrefillError || error instanceof DocuSignConfigError) {
    return Errors.validationError(error.message);
  }
  if (isClientError(error)) {
    return Errors.envelopeCreationFailed();
  }
  return Errors.providerUnavailable();
};

export const createDocuSignProvider = (
  options: DocuSignProviderOptions,
): DocuSignProviderHandle => {
  const getConfig = () =>
    typeof options.config === 'function' ? options.config() : options.config;
  const makeClient = options.createClient ?? createDocuSignClient;

  // One client (and token cache) per handle, built on first use
  let client: DocuSignClient | null = null;
  const getClient = (): DocuSignClient => {
    if (!client) {
      client = makeClient(getConfig());
    }
    return client;
  };

  // Prefilled Web Forms instance; needs the form id. The instance carries
  // the configured returnUrl so a plain WebView/iframe host gets the
  // outcome without DocuSign.js. Errors map like createEnvelope. Exposed
  // under both port names.
  const createHostedFormInstance = async (
    userId: string,
    prefill: WebFormPrefill,
  ): Promise<HostedFormInstanceResult> => {
    if (!getConfig().webFormId) {
      throw Errors.validationError('DOCUSIGN_WEBFORM_ID is not configured');
    }
    try {
      return await createWebFormInstance({
        client: getClient(),
        userId,
        prefill,
      });
    } catch (error) {
      throw creationError(error);
    }
  };

  return {
    reset() {
      client = null;
    },

    async createEnvelope(
      _userId: string,
      _contractType: string,
      recipient: RecipientData,
      prefill?: EnvelopePrefill,
    ): Promise<EnvelopeResult> {
      try {
        // Refused before any request, like a bad Web Forms prefill: the
        // caller's error, not the provider's, and not worth a retry. The same
        // for a missing template: reported once, not after three attempts.
        const tabs =
          prefill === undefined ? undefined : assertEnvelopePrefill(prefill);
        const docusign = getClient();
        assertDocuSignConfig(docusign.config, ['accountId', 'templateId']);
        const envelope = await withRetry(() =>
          docusign.createEnvelopeFromTemplate(recipient, tabs),
        );
        const signingUrl = await withRetry(() =>
          docusign.getEmbeddedSigningUrl(envelope.envelopeId, recipient),
        );
        return { envelopeId: envelope.envelopeId, signingUrl };
      } catch (error) {
        throw creationError(error);
      }
    },

    async getEnvelopeStatus(envelopeId: string): Promise<EnvelopeStatus> {
      try {
        const response = await withRetry(() =>
          getClient().fetchEnvelopeStatus(envelopeId),
        );
        return mapDocuSignStatus(response.status);
      } catch (error) {
        if (isNotFoundError(error)) {
          throw Errors.envelopeNotFound();
        }
        throw Errors.providerUnavailable();
      }
    },

    async getSigningUrl(
      envelopeId: string,
      recipient: RecipientData,
    ): Promise<SigningUrlResult> {
      try {
        const signingUrl = await withRetry(() =>
          getClient().getEmbeddedSigningUrl(envelopeId, recipient),
        );
        return { signingUrl };
      } catch (error) {
        // Any non-retryable client error (including 404) maps to "not found" -
        // never leak why the provider rejected the envelope
        if (isClientError(error)) {
          throw Errors.envelopeNotFound();
        }
        throw Errors.providerUnavailable();
      }
    },

    // HMAC-SHA256 over the raw body, delivered in X-DocuSign-Signature-1
    verifyWebhook(
      headers: WebhookHeaders,
      rawBody: string,
      ip?: string,
    ): boolean {
      const headerValue = headers[DOCUSIGN_SIGNATURE_HEADER];
      const signature =
        typeof headerValue === 'string' ? headerValue : undefined;
      return validateHmac(signature, rawBody, {
        hmacKey: options.webhook.hmacKey(),
        allowMissingKey: options.webhook.allowMissingKey?.() ?? false,
        ip,
        logger: options.webhook.logger,
      });
    },

    parseWebhookEvent(rawBody: string): WebhookEvent | null {
      return parseDocuSignWebhook(rawBody);
    },

    createHostedFormInstance,
    createWebFormInstance: createHostedFormInstance,
  };
};
