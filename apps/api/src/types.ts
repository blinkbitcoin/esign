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

// Prefill values for a Web Forms instance (DocuSign's formValues contract,
// verified 2026-09). Keys are the form's field API reference names; the value
// shape follows the field type:
//   TextBox / Email / Date (yyyy-mm-dd) / Select / RadioButtonGroup → string
//   Number → number (unquoted, '.' decimal, no thousands separators)
//   CheckboxGroup → string[]
//   PhoneNumber → { countryCode?, nationalNumber }
// Values minted this way can populate READ-ONLY form fields - the only
// supported way to lock a value the signer must not change (prefill by URL or
// Docusign JS cannot populate read-only fields).
export interface WebFormPhoneNumber {
  countryCode?: string;
  nationalNumber: string;
}
export type WebFormPrefillValue = string | number | string[] | WebFormPhoneNumber;
export type WebFormPrefill = Record<string, WebFormPrefillValue>;

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
