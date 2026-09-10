// The DocuSign Web Forms prefill contract, mirroring @blinkbitcoin/esign-node
// (parity-tested): keys are field API reference names, the value shape
// follows the field type. Number → number (unquoted), CheckboxGroup →
// string[], PhoneNumber → object.

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
