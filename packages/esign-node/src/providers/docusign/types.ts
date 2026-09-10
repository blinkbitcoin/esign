// DocuSign's prefill contract: the value shapes a Web Forms instance accepts.

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
