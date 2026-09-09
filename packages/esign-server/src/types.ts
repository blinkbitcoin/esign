// Wire-level types of the DocuSign client.

// A signer (envelope recipient / form submitter)
export interface RecipientData {
  name: string;
  email: string;
}

// Prefill values for a Web Forms instance (DocuSign's formValues contract,
// verified 2026-09). Keys are the form's field API reference names; the value
// shape follows the field type:
//   TextBox / Email / Date (yyyy-mm-dd) / Select / RadioButtonGroup → string
//   Number → number (unquoted, '.' decimal, no thousands separators, max 2 dp)
//   CheckboxGroup → string[]
//   PhoneNumber → { countryCode?, nationalNumber } (standalone forms only)
// Values minted this way can populate READ-ONLY form fields - the only
// supported way to lock a value the signer must not change (prefill by URL or
// Docusign JS cannot populate read-only fields).
export interface WebFormPhoneNumber {
  countryCode?: string;
  nationalNumber: string;
}
export type WebFormPrefillValue =
  | string
  | number
  | string[]
  | WebFormPhoneNumber;
export type WebFormPrefill = Record<string, WebFormPrefillValue>;

// --- Hosted forms (provider-neutral) ---------------------------------------
//
// A hosted form is a provider-hosted, prefilled form the backend mints an
// instance URL for (DocuSign Web Forms is the one adapter today). The neutral
// prefill is a flat record; a provider narrows the value shapes it accepts
// (WebFormPrefill above for DocuSign).
export type HostedFormPrefill = Record<string, unknown>;

// Options for minting a hosted-form instance
export interface HostedFormInstanceOptions {
  // Where the provider sends the signer after signing. A host that embeds the
  // form in a WebView/iframe points this at a bridge page that reports the
  // outcome back (the esign service's /signing/return does exactly that).
  returnUrl?: string;
  // Hours until the instance expires (the provider default applies when unset).
  // Note the instance TOKEN in the URL still expires ~5 minutes after minting.
  expirationOffsetHours?: number;
}

// A minted hosted-form instance
export interface HostedFormInstanceResult {
  // Embeddable instance URL (formUrl#instanceToken=...)
  url: string;
  // Provider-side instance id, when the provider returns one
  instanceId?: string;
}

/** @deprecated Use HostedFormInstanceOptions */
export type WebFormInstanceOptions = HostedFormInstanceOptions;
/** @deprecated Use HostedFormInstanceResult */
export type WebFormInstanceResult = HostedFormInstanceResult;

// fetch, late-bound so tests can replace the global (Node 18+ ships fetch)
export type FetchLike = (
  input: string,
  init?: RequestInit,
) => Promise<Response>;

// --- Envelope domain ---------------------------------------------------------

// Possible envelope statuses (the normalized vocabulary every provider maps to)
export type EnvelopeStatus = 'sent' | 'completed' | 'voided' | 'declined';

// Result from creating an envelope at the provider
export interface EnvelopeResult {
  envelopeId: string;
  signingUrl: string;
}

// Result from getting a signing URL
export interface SigningUrlResult {
  signingUrl: string;
}

// Inbound webhook headers (framework-neutral shape of Express/Node headers)
export type WebhookHeaders = Record<string, string | string[] | undefined>;

// Parsed inbound webhook event, normalized across providers
export interface WebhookEvent {
  // The provider's envelope ID (maps to the stored provider envelope ID)
  providerEnvelopeId: string;
  // Normalized status; null when the provider sent an event we don't track
  // (such events are acknowledged and ignored)
  status: EnvelopeStatus | null;
  // The provider's raw status string, for diagnostics
  rawStatus: string;
}

// Inputs of the envelope service
export interface CreateEnvelopeInput {
  contractType: string;
  recipient: RecipientData;
}
export interface GetSigningUrlInput {
  envelopeId: string;
  recipient: RecipientData;
}
