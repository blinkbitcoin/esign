// The mock adapter: no external API, envelopes and Web Forms instances live
// in memory, and the signing pages are URLs under a host-provided base (the
// esign service serves them). Webhooks keep DocuSign's Connect format so the
// full webhook path runs without credentials.

import { randomUUID } from 'node:crypto';
import { Errors } from '../errors';
import type { ESignProvider } from '../provider';
import type {
  EnvelopeResult,
  EnvelopeStatus,
  RecipientData,
  SigningUrlResult,
  WebFormInstanceResult,
  WebFormPrefill,
  WebhookEvent,
  WebhookHeaders,
} from '../types';

export interface MockProviderOptions {
  // Where the mock signing pages are served (read per call: the port may
  // only be known at runtime)
  baseUrl: () => string;
  // The webhook implementation to mirror (normally the DocuSign adapter's)
  webhook: Pick<ESignProvider, 'verifyWebhook' | 'parseWebhookEvent'>;
}

export interface MockProviderHandle extends ESignProvider {
  // Test helpers
  setEnvelopeStatus(envelopeId: string, status: EnvelopeStatus): void;
  addEnvelope(
    envelopeId: string,
    options?: {
      status?: EnvelopeStatus;
      userId?: string;
      contractType?: string;
    },
  ): void;
  clearEnvelopes(): void;
  // The prefill a mock Web Forms instance was minted with (undefined for an
  // unknown instance, e.g. a public-form URL that never called createInstance)
  getWebFormPrefill(instanceId: string): WebFormPrefill | undefined;
}

export const createMockProvider = (
  options: MockProviderOptions,
): MockProviderHandle => {
  const envelopes = new Map<
    string,
    { status: EnvelopeStatus; userId: string; contractType: string }
  >();
  // Like a real instance, whose formValues DocuSign stores server-side
  const webFormInstances = new Map<string, WebFormPrefill>();

  return {
    async createEnvelope(
      userId: string,
      contractType: string,
      _recipient: RecipientData,
    ): Promise<EnvelopeResult> {
      const envelopeId = randomUUID();
      envelopes.set(envelopeId, { status: 'sent', userId, contractType });
      return {
        envelopeId,
        signingUrl: `${options.baseUrl()}/signing/mock/${envelopeId}`,
      };
    },

    async getEnvelopeStatus(envelopeId: string): Promise<EnvelopeStatus> {
      const envelope = envelopes.get(envelopeId);
      if (!envelope) {
        throw Errors.envelopeNotFound();
      }
      return envelope.status;
    },

    async getSigningUrl(
      envelopeId: string,
      _recipient: RecipientData,
    ): Promise<SigningUrlResult> {
      if (!envelopes.get(envelopeId)) {
        throw Errors.envelopeNotFound();
      }
      return {
        signingUrl: `${options.baseUrl()}/signing/mock/${envelopeId}?restart=true`,
      };
    },

    verifyWebhook(
      headers: WebhookHeaders,
      rawBody: string,
      ip?: string,
    ): boolean {
      return options.webhook.verifyWebhook(headers, rawBody, ip);
    },

    parseWebhookEvent(rawBody: string): WebhookEvent | null {
      return options.webhook.parseWebhookEvent(rawBody);
    },

    async createWebFormInstance(
      userId: string,
      prefill: WebFormPrefill,
    ): Promise<WebFormInstanceResult> {
      const instanceId = randomUUID();
      envelopes.set(instanceId, {
        status: 'sent',
        userId,
        contractType: 'webform',
      });
      webFormInstances.set(instanceId, prefill);
      return {
        url: `${options.baseUrl()}/signing/mock-webform/${instanceId}`,
        instanceId,
      };
    },

    setEnvelopeStatus(envelopeId, status) {
      const envelope = envelopes.get(envelopeId);
      if (envelope) {
        envelope.status = status;
      }
    },

    addEnvelope(envelopeId, overrides = {}) {
      envelopes.set(envelopeId, {
        status: overrides.status ?? 'sent',
        userId: overrides.userId ?? 'test-user',
        contractType: overrides.contractType ?? 'test-contract',
      });
    },

    clearEnvelopes() {
      envelopes.clear();
      webFormInstances.clear();
    },

    getWebFormPrefill(instanceId) {
      return webFormInstances.get(instanceId);
    },
  };
};
