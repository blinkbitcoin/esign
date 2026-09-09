// Minting a DocuSign Web Forms instance through the host's own backend: the
// hosted-form minter (./hostedForm/mint) bound to the DocuSign prefill
// contract. The backend holds the DocuSign credentials
// (@blinkbitcoin/esign-server does the DocuSign call); this is only the
// client half. No Apollo/GraphQL dependency.

import { createHostedFormMinter } from './hostedForm/mint';

import type {
  HostedFormInstance,
  MintHostedFormOptions,
} from './hostedForm/mint';

// The prefill contract, mirroring @blinkbitcoin/esign-server (parity-tested):
// keys are field API reference names, the value shape follows the field type.
// Number → number (unquoted), CheckboxGroup → string[], PhoneNumber → object.
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

/** The mint endpoint options; the same shape as `MintHostedFormOptions`. */
export type MintWebFormsInstanceOptions = MintHostedFormOptions;

/**
 * Build the `createInstance` call for createWebFormsSource from an endpoint
 * and a prefill. Mint right before opening the form: the instance token in
 * the returned URL lives about five minutes.
 */
export const createWebFormsMinter = (
  mint: MintWebFormsInstanceOptions,
  prefill: WebFormPrefill = {},
): (() => Promise<HostedFormInstance>) =>
  createHostedFormMinter<WebFormPrefill>(mint, prefill);
