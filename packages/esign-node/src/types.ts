// Wire-level types of the DocuSign client.

// A signer (envelope recipient / form submitter)
export interface RecipientData {
  name: string;
  email: string;
}

// DocuSign's prefill contracts (docusign/types.ts); re-exported here so the
// names keep resolving from this module
export type {
  EnvelopeTabPrefill,
  EnvelopeTabValue,
  WebFormPhoneNumber,
  WebFormPrefill,
  WebFormPrefillValue,
} from './providers/docusign/types';

// --- Hosted forms (provider-neutral) ---------------------------------------
//
// A hosted form is a provider-hosted, prefilled form the backend mints an
// instance URL for (DocuSign Web Forms is the one adapter today). The neutral
// prefill is a flat record; a provider narrows the value shapes it accepts
// (WebFormPrefill for DocuSign).
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

// The values a host computed for the document's own fields, keyed by whatever
// the provider calls them (DocuSign: the template's tab labels). Neutral like
// HostedFormPrefill; a provider narrows the value shapes it accepts and
// refuses the rest before any request (DocuSign: EnvelopeTabPrefill, checked
// by parseEnvelopePrefill).
export type EnvelopePrefill = Record<string, unknown>;

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
  // The host's own values for the document's fields, locked where the signer
  // must not change them. Supplied by the host process that calls the
  // service; deliberately absent from the GraphQL mutation, since terms the
  // signer cannot change must not be the client's to send.
  prefill?: EnvelopePrefill;
}
export interface GetSigningUrlInput {
  envelopeId: string;
  recipient: RecipientData;
}
