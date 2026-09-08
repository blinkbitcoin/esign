// The e-signature provider PORT (hexagonal architecture). Adapters implement
// it (providers/docusign.ts, providers/mock.ts); the envelope service and any
// HTTP layer depend only on this port, so nothing provider-specific leaks
// past it.

import type {
  EnvelopeResult,
  EnvelopeStatus,
  RecipientData,
  SigningUrlResult,
  WebFormInstanceResult,
  WebFormPrefill,
  WebhookEvent,
  WebhookHeaders,
} from './types';

export interface ESignProvider {
  createEnvelope(
    userId: string,
    contractType: string,
    recipient: RecipientData,
  ): Promise<EnvelopeResult>;

  getEnvelopeStatus(envelopeId: string): Promise<EnvelopeStatus>;

  // Get new signing URL for existing envelope (session-expiration restart)
  getSigningUrl(
    envelopeId: string,
    recipient: RecipientData,
  ): Promise<SigningUrlResult>;

  // Verify an inbound webhook's authenticity (signature headers etc.)
  verifyWebhook(headers: WebhookHeaders, rawBody: string, ip?: string): boolean;

  // Parse a verified webhook body into a normalized event (null = malformed)
  parseWebhookEvent(rawBody: string): WebhookEvent | null;

  // Create a prefilled Web Forms signing instance (DocuSign Web Forms).
  // Optional: providers without form-based signing omit it; callers gate on
  // `supportsWebForms(provider)`.
  createWebFormInstance?(
    userId: string,
    prefill: WebFormPrefill,
  ): Promise<WebFormInstanceResult>;
}

// Capability check: true when the provider supports Web Forms instances.
export const supportsWebForms = (
  provider: ESignProvider,
): provider is ESignProvider &
  Required<Pick<ESignProvider, 'createWebFormInstance'>> =>
  typeof provider.createWebFormInstance === 'function';
