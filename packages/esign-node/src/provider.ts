// The e-signature provider PORT (hexagonal architecture). Adapters implement
// it (docusign/provider.ts, mock/provider.ts); the envelope service and any
// HTTP layer depend only on this port, so nothing provider-specific leaks
// past it.

import type {
  EnvelopeResult,
  EnvelopeStatus,
  HostedFormInstanceResult,
  HostedFormPrefill,
  RecipientData,
  SigningUrlResult,
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

  // Mint a prefilled hosted-form instance (DocuSign: a Web Forms instance).
  // Optional: providers without form-based signing omit it; callers gate on
  // `supportsHostedForms(provider)` or mint through `hostedFormMint(provider)`.
  createHostedFormInstance?(
    userId: string,
    prefill: HostedFormPrefill,
  ): Promise<HostedFormInstanceResult>;

  /**
   * @deprecated Implement createHostedFormInstance. Adapters written against
   * this name keep working: hostedFormMint / supportsHostedForms accept either.
   */
  createWebFormInstance?(
    userId: string,
    prefill: HostedFormPrefill,
  ): Promise<HostedFormInstanceResult>;
}

// The mint call of a provider (or a bound package function): user + prefill
// → the instance
export type HostedFormMint = (
  userId: string,
  prefill: HostedFormPrefill,
) => Promise<HostedFormInstanceResult>;

// A provider with the hosted-form capability, under either name
export type HostedFormProvider = ESignProvider &
  (
    | Required<Pick<ESignProvider, 'createHostedFormInstance'>>
    | Required<Pick<ESignProvider, 'createWebFormInstance'>>
  );

// The capability method, if any: the neutral name first, the deprecated
// name for adapters that predate it
const hostedFormMethod = (
  provider: ESignProvider,
): ESignProvider['createHostedFormInstance'] => {
  if (typeof provider.createHostedFormInstance === 'function') {
    return provider.createHostedFormInstance;
  }
  if (typeof provider.createWebFormInstance === 'function') {
    return provider.createWebFormInstance;
  }
  return undefined;
};

// Capability check: true when the provider mints hosted-form instances
export const supportsHostedForms = (
  provider: ESignProvider,
): provider is HostedFormProvider => hostedFormMethod(provider) !== undefined;

/**
 * @deprecated Use supportsHostedForms. Same check; the narrowing keeps the
 * old name required so existing call sites still compile.
 */
export const supportsWebForms = (
  provider: ESignProvider,
): provider is ESignProvider &
  Required<Pick<ESignProvider, 'createWebFormInstance'>> =>
  supportsHostedForms(provider);

// The provider's mint as a plain function (bound to the provider), or
// undefined when it has no hosted-form capability. Whichever of
// createHostedFormInstance / createWebFormInstance exists is used.
export const hostedFormMint = (
  provider: ESignProvider,
): HostedFormMint | undefined => {
  const method = hostedFormMethod(provider);
  return method
    ? (userId, prefill) => method.call(provider, userId, prefill)
    : undefined;
};
