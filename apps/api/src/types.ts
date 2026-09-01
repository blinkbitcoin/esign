// Shared types for e-signature backend
// Following named export pattern as per architecture

// Recipient data for envelope creation
export interface RecipientData {
  name: string;
  email: string;
}

// Result from creating an envelope
export interface EnvelopeResult {
  envelopeId: string;
  signingUrl: string;
}

// Possible envelope statuses
export type EnvelopeStatus = 'sent' | 'completed' | 'voided' | 'declined';

// Result from getting a signing URL
export interface SigningUrlResult {
  signingUrl: string;
}

// Prefill values for a Web Forms instance. Keys are the form's field
// API reference names; values are strings (DocuSign's formValues contract).
export type WebFormPrefill = Record<string, string>;

// Result from creating a Web Forms signing instance
export interface WebFormInstanceResult {
  // Embeddable instance URL (formUrl#instanceToken=... for DocuSign)
  url: string;
  // Optional provider-side instance id
  instanceId?: string;
}

// Inbound webhook headers (framework-neutral shape of Express/Node headers)
export type WebhookHeaders = Record<string, string | string[] | undefined>;

// Parsed inbound webhook event, normalized across providers
export interface WebhookEvent {
  // The provider's envelope ID (maps to our stored provider envelope ID)
  providerEnvelopeId: string;
  // Normalized status; null when the provider sent an event we don't track
  // (such events are acknowledged and ignored)
  status: EnvelopeStatus | null;
  // The provider's raw status string, for diagnostics
  rawStatus: string;
}

// GraphQL input types
export interface CreateEnvelopeInput {
  contractType: string;
  recipient: RecipientData;
}

// Context type for Apollo Server resolvers
export interface GraphQLContext {
  userId: string | null;
}
