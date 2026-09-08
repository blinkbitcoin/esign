// Validation of the `prefill` object POST /webform/instance accepts, plus the
// display formatting the mock web-form page uses.
//
// The prefill is forwarded verbatim to the provider (DocuSign: formValues), so
// the wire shape is enforced here at the edge: a request that would be
// rejected by DocuSign with an opaque 400 is rejected by us with a reason,
// and nothing but the documented value shapes ever reaches the provider.

import type { WebFormPrefill, WebFormPrefillValue } from './types';

// Field API reference names as the Web Forms builder shows them (componentName)
const FIELD_NAME = /^[A-Za-z0-9_-]{1,100}$/;

// Generous upper bound on fields per instance; the JSON body limit bounds the
// bytes, this bounds the work per request.
export const MAX_PREFILL_FIELDS = 200;

export type ParsedWebFormPrefill =
  | { ok: true; prefill: WebFormPrefill }
  | { ok: false; error: string };

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isPhoneNumber = (value: Record<string, unknown>): boolean =>
  Object.keys(value).every((key) => key === 'countryCode' || key === 'nationalNumber') &&
  typeof value.nationalNumber === 'string' &&
  (value.countryCode === undefined || typeof value.countryCode === 'string');

const isPrefillValue = (value: unknown): value is WebFormPrefillValue =>
  typeof value === 'string' ||
  (typeof value === 'number' && Number.isFinite(value)) ||
  (Array.isArray(value) && value.every((item) => typeof item === 'string')) ||
  (isPlainObject(value) && isPhoneNumber(value));

// Echo at most this much of an offending key back to the caller
const describeName = (name: string): string => JSON.stringify(name.slice(0, 100));

// Parse the raw `prefill` from a request body. `undefined` (no body / no
// prefill) is an empty prefill; anything else must be a flat object of
// supported values keyed by field API reference names.
export const parseWebFormPrefill = (input: unknown): ParsedWebFormPrefill => {
  if (input === undefined) {
    return { ok: true, prefill: {} };
  }
  if (!isPlainObject(input)) {
    return { ok: false, error: 'prefill must be an object' };
  }
  const entries = Object.entries(input);
  if (entries.length > MAX_PREFILL_FIELDS) {
    return { ok: false, error: `prefill has more than ${MAX_PREFILL_FIELDS} fields` };
  }
  for (const [name, value] of entries) {
    if (!FIELD_NAME.test(name)) {
      return { ok: false, error: `invalid field name ${describeName(name)}` };
    }
    if (!isPrefillValue(value)) {
      return { ok: false, error: `unsupported value for field ${describeName(name)}` };
    }
  }
  // fromEntries defines own properties (no setter dispatch), so a "__proto__"
  // key - which passes FIELD_NAME - can never reach Object.prototype.
  return { ok: true, prefill: Object.fromEntries(entries) as WebFormPrefill };
};

// Human-readable rendering of a prefill value (what a form would display)
export const formatPrefillValue = (value: WebFormPrefillValue): string => {
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number') {
    return String(value);
  }
  if (Array.isArray(value)) {
    return value.join(', ');
  }
  return value.countryCode ? `+${value.countryCode} ${value.nationalNumber}` : value.nationalNumber;
};
