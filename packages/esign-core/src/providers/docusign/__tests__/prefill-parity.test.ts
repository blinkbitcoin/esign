// The prefill contract is declared twice on purpose - once in the server
// package (the DocuSign side) and once here (the client side, which must stay
// free of Node-only dependencies). This pins the two together: the test
// fails to compile if either drifts.

import type {
  WebFormPhoneNumber as ServerPhoneNumber,
  WebFormPrefill as ServerPrefill,
  WebFormPrefillValue as ServerValue,
} from '../../../../../esign-server/src/types';
import type {
  WebFormPhoneNumber,
  WebFormPrefill,
  WebFormPrefillValue,
} from '../prefill';

// Mutual assignability = identical shapes
type Equals<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

const prefill: Equals<WebFormPrefill, ServerPrefill> = true;
const value: Equals<WebFormPrefillValue, ServerValue> = true;
const phone: Equals<WebFormPhoneNumber, ServerPhoneNumber> = true;

describe('prefill contract parity (core ↔ server)', () => {
  it('declares the same shapes', () => {
    expect(prefill && value && phone).toBe(true);
  });
});
