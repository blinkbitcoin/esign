// Validation of a prefill - a Web Forms instance's formValues or an envelope's
// tab values - plus the display formatting of a Web Forms value.
//
// A prefill is forwarded verbatim to DocuSign, so the wire shape is enforced
// at the edge: a request DocuSign would reject with an opaque 400 (or, for an
// envelope tab, silently render as an empty editable field) is rejected here
// with a reason that names the field, and nothing but the documented value
// shapes ever reaches the API. Both contracts share one parser; they differ
// only in which values a field may hold.

import type {
  EnvelopeTabPrefill,
  EnvelopeTabValue,
  WebFormPrefill,
  WebFormPrefillValue,
} from './types';

// Field API reference names as the Web Forms builder shows them
// (componentName); DocuSign tab labels are drawn from the same alphabet.
const FIELD_NAME = /^[A-Za-z0-9_-]{1,100}$/;

// Generous upper bound on fields per instance / tabs per envelope
export const MAX_PREFILL_FIELDS = 200;

type ParsedPrefill<Value> =
  | { ok: true; prefill: Record<string, Value> }
  | { ok: false; error: string };
export type ParsedWebFormPrefill = ParsedPrefill<WebFormPrefillValue>;
export type ParsedEnvelopePrefill = ParsedPrefill<string | EnvelopeTabValue>;

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

// Echo at most this much of an offending key back to the caller
const describeName = (name: string): string =>
  JSON.stringify(name.slice(0, 100));

// Parse a raw prefill (e.g. from a request body). `undefined` is an empty
// prefill; anything else must be a flat object keyed by field names whose
// values `isValue` accepts.
const parsePrefill = <Value>(
  input: unknown,
  isValue: (value: unknown) => value is Value,
): ParsedPrefill<Value> => {
  if (input === undefined) {
    return { ok: true, prefill: {} };
  }
  if (!isPlainObject(input)) {
    return { ok: false, error: 'prefill must be an object' };
  }
  const entries = Object.entries(input);
  if (entries.length > MAX_PREFILL_FIELDS) {
    return {
      ok: false,
      error: `prefill has more than ${MAX_PREFILL_FIELDS} fields`,
    };
  }
  for (const [name, value] of entries) {
    if (!FIELD_NAME.test(name)) {
      return { ok: false, error: `invalid field name ${describeName(name)}` };
    }
    if (!isValue(value)) {
      return {
        ok: false,
        error: `unsupported value for field ${describeName(name)}`,
      };
    }
  }
  // fromEntries defines own properties (no setter dispatch), so a "__proto__"
  // key - which passes FIELD_NAME - can never reach Object.prototype.
  return {
    ok: true,
    prefill: Object.fromEntries(entries) as Record<string, Value>,
  };
};

// A prefill that failed validation
export class PrefillError extends Error {
  constructor(reason: string) {
    super(`Invalid prefill: ${reason}`);
    this.name = 'PrefillError';
  }
}
/** @deprecated The error is `PrefillError`; this name is kept for imports. */
export { PrefillError as WebFormPrefillError };

const assertPrefill = <Value>(parsed: ParsedPrefill<Value>) => {
  if (!parsed.ok) {
    throw new PrefillError(parsed.error);
  }
  return parsed.prefill;
};

// --- Web Forms ---------------------------------------------------------------

const isPhoneNumber = (value: Record<string, unknown>): boolean =>
  Object.keys(value).every(
    key => key === 'countryCode' || key === 'nationalNumber',
  ) &&
  typeof value.nationalNumber === 'string' &&
  (value.countryCode === undefined || typeof value.countryCode === 'string');

const isWebFormPrefillValue = (value: unknown): value is WebFormPrefillValue =>
  typeof value === 'string' ||
  (typeof value === 'number' && Number.isFinite(value)) ||
  (Array.isArray(value) && value.every(item => typeof item === 'string')) ||
  (isPlainObject(value) && isPhoneNumber(value));

// The formValues contract: field API reference names to the documented shapes
export const parseWebFormPrefill = (input: unknown): ParsedWebFormPrefill =>
  parsePrefill(input, isWebFormPrefillValue);

// parseWebFormPrefill, throwing PrefillError instead of returning the reason
export const assertWebFormPrefill = (input: unknown): WebFormPrefill =>
  assertPrefill(parseWebFormPrefill(input));

// --- Envelopes ---------------------------------------------------------------

const isEnvelopeTabValue = (value: unknown): value is EnvelopeTabValue =>
  isPlainObject(value) &&
  Object.keys(value).every(key => key === 'value' || key === 'locked') &&
  typeof value.value === 'string' &&
  (value.locked === undefined || typeof value.locked === 'boolean') &&
  // A locked tab with nothing in it can never be filled: neither the host
  // (it is sent now) nor the signer (it refuses edits) gets another chance.
  !(value.locked === true && value.value.trim() === '');

// The tab-value contract: tab labels to text, bare or with a boolean `locked`.
// DocuSign does not refuse a value outside it (a number arrives as an empty
// tab the signer can edit), so it is checked before the request.
export const parseEnvelopePrefill = (input: unknown): ParsedEnvelopePrefill =>
  parsePrefill(
    input,
    (value): value is string | EnvelopeTabValue =>
      typeof value === 'string' || isEnvelopeTabValue(value),
  );

// parseEnvelopePrefill, throwing PrefillError instead of returning the reason
export const assertEnvelopePrefill = (input: unknown): EnvelopeTabPrefill =>
  assertPrefill(parseEnvelopePrefill(input));

// --- Display -----------------------------------------------------------------

// Human-readable rendering of a Web Forms value (what a form would display)
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
  return value.countryCode
    ? `+${value.countryCode} ${value.nationalNumber}`
    : value.nationalNumber;
};
