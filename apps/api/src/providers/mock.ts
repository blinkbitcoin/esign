// Mock e-signature adapter for development and testing (no external API).
// Implements the ESignProvider port and mirrors DocuSign's Connect webhook
// format (delegating verify/parse to the DocuSign adapter) so the full webhook
// path can be exercised without credentials.

import { randomUUID } from 'crypto';

import { Errors } from '../errors';
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
import { DocuSignProvider } from './docusign';
import type { ESignProvider } from './port';

// In-memory storage for mock envelopes
const envelopes = new Map<
  string,
  { status: EnvelopeStatus; userId: string; contractType: string }
>();

const getBaseUrl = (): string => {
  const port = process.env.PORT || 4000;
  return `http://localhost:${port}`;
};

export const MockProvider: ESignProvider = {
  async createEnvelope(
    userId: string,
    contractType: string,
    _recipient: RecipientData
  ): Promise<EnvelopeResult> {
    const envelopeId = randomUUID();
    envelopes.set(envelopeId, { status: 'sent', userId, contractType });
    return {
      envelopeId,
      signingUrl: `${getBaseUrl()}/signing/mock/${envelopeId}`,
    };
  },

  async getEnvelopeStatus(envelopeId: string): Promise<EnvelopeStatus> {
    const envelope = envelopes.get(envelopeId);
    if (!envelope) {
      throw Errors.envelopeNotFound();
    }
    return envelope.status;
  },

  async getSigningUrl(envelopeId: string, _recipient: RecipientData): Promise<SigningUrlResult> {
    const envelope = envelopes.get(envelopeId);
    if (!envelope) {
      throw Errors.envelopeNotFound();
    }
    return {
      signingUrl: `${getBaseUrl()}/signing/mock/${envelopeId}?restart=true`,
    };
  },

  // The mock simulates DocuSign's Connect callback format, so the full webhook
  // path (signature validation, payload parsing, status sync) runs end-to-end
  // without DocuSign credentials.
  verifyWebhook(headers: WebhookHeaders, rawBody: string, ip?: string): boolean {
    return DocuSignProvider.verifyWebhook(headers, rawBody, ip);
  },

  parseWebhookEvent(rawBody: string): WebhookEvent | null {
    return DocuSignProvider.parseWebhookEvent(rawBody);
  },

  // Mock a DocuSign Web Forms instance: returns a URL to the local mock
  // web-form page (which emits the real DocuSign event vocabulary), so the full
  // Web Forms flow runs without credentials. Prefill is accepted and ignored.
  async createWebFormInstance(
    userId: string,
    _prefill: WebFormPrefill
  ): Promise<WebFormInstanceResult> {
    const instanceId = randomUUID();
    envelopes.set(instanceId, { status: 'sent', userId, contractType: 'webform' });
    return {
      url: `${getBaseUrl()}/signing/mock-webform/${instanceId}`,
      instanceId,
    };
  },
};

// Test helper: Set envelope status for simulating status transitions
export const setEnvelopeStatus = (envelopeId: string, status: EnvelopeStatus): void => {
  const envelope = envelopes.get(envelopeId);
  if (envelope) {
    envelope.status = status;
  }
};

// Test helper: Add envelope directly (for tests that mock the db but need provider state)
export const addEnvelope = (
  envelopeId: string,
  options: { status?: EnvelopeStatus; userId?: string; contractType?: string } = {}
): void => {
  envelopes.set(envelopeId, {
    status: options.status ?? 'sent',
    userId: options.userId ?? 'test-user',
    contractType: options.contractType ?? 'test-contract',
  });
};

// Test helper: Clear all envelopes for test isolation
export const clearEnvelopes = (): void => {
  envelopes.clear();
};
