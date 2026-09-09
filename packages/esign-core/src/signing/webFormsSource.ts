// DocuSign Web Forms (API-embedded) signing source: the hosted-form source
// (./hostedForm/source) bound to the DocuSign event interpreter and prefill
// contract. The host's backend mints the instance (it holds the DocuSign
// credentials; read-only fields come back locked with the values it
// prefilled). The host either points this source at that endpoint (`mint` +
// `prefill`) or injects its own `createInstance` call. No Apollo/GraphQL
// dependency.

import { interpretDocuSignEvent } from './events';
import {
  createHostedFormSource,
  resolveHostedFormCreateInstance,
} from './hostedForm/source';

import type { HostedFormInstance } from './hostedForm/mint';
import type {
  HostedFormCreateInstanceOptions,
  HostedFormMintOptions,
} from './hostedForm/source';
import type { WebFormPrefill } from './mint';
import type { SigningSource } from './types';

/** The minted instance ({ url, envelopeId? }); the same shape as `HostedFormInstance`. */
export type WebFormsInstance = HostedFormInstance;

/** The host brings its own backend client. */
export type WebFormsCreateInstanceOptions = Omit<
  HostedFormCreateInstanceOptions,
  'interpret'
>;

/** The host names its mint endpoint and the prefill; the source does the call. */
export type WebFormsMintOptions = Omit<
  HostedFormMintOptions<WebFormPrefill>,
  'interpret'
>;

export type WebFormsSigningSourceOptions =
  | WebFormsCreateInstanceOptions
  | WebFormsMintOptions;

/** The createInstance call for either option shape. */
export const resolveCreateInstance = (
  options: WebFormsSigningSourceOptions,
): (() => Promise<WebFormsInstance>) =>
  resolveHostedFormCreateInstance<WebFormPrefill>(options);

// Understands both the DocuSign.js `sessionEnd` shape and the return-URL
// bridge's `{ event }` shape, so a real form finishing via returnUrl in a
// plain WebView/iframe is read the same way as one embedded via DocuSign.js
export const createWebFormsSource = (
  options: WebFormsSigningSourceOptions,
): SigningSource =>
  createHostedFormSource<WebFormPrefill>({
    ...options,
    interpret: interpretDocuSignEvent,
  });
