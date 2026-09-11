// DocuSign's prefill contracts: the value shapes a Web Forms instance accepts,
// and the ones an envelope's tabs accept.

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

// --- Envelopes ---------------------------------------------------------------
//
// The other way to put a value on the document: write the template's tabs when
// the envelope is created. Unlike a form's read-only fields this needs nothing
// configured at DocuSign - the lock travels with the value - and it opens on
// the document itself rather than on a form that asks for it first.

/**
 * One value written onto the template's tab of the same label.
 *
 * Locked is what makes an envelope carry terms the signer cannot change: the
 * field is rendered with the value and refuses edits, which is the envelope's
 * answer to what a read-only Web Form field does.
 */
export interface EnvelopeTabValue {
  value: string;
  locked?: boolean;
}

// Tab label to value. A bare string (or a value without `locked`) keeps the
// lock the template designer set on that tab; `locked: true` locks it,
// `locked: false` unlocks it on purpose.
//
// Every key must name a **Text** tab on the signer's role: DocuSign matches
// a template-role value by tab type + label, so a label naming a Number,
// Date or List tab is ignored with a 200 and an empty, editable field. Text
// is also the only type that takes an arbitrary string (a BTC amount has no
// place in a DocuSign Number, which holds two decimals): format money and
// dates as the strings the signer must see.
export type EnvelopeTabPrefill = Record<string, string | EnvelopeTabValue>;
