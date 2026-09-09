// DocuSign Web Forms signing sources: the provider-neutral hosted-form layer
// (signing/hostedForm) bound to the DocuSign event interpreter and prefill
// contract. API-embedded (createWebFormsSource: the host's backend mints the
// instance - it holds the DocuSign credentials; read-only fields come back
// locked with the values it prefilled - through `mint` + `prefill` or the
// host's own `createInstance` call) and public URL (createPublicUrlSource: a
// published form link, no backend). No Apollo/GraphQL dependency.

import type {
  HostedFormInstance,
  MintHostedFormOptions,
} from '../../signing/hostedForm/mint';
import { createHostedFormMinter } from '../../signing/hostedForm/mint';
import type { HostedFormPublicUrlSourceOptions } from '../../signing/hostedForm/publicUrlSource';
import { createHostedFormPublicUrlSource } from '../../signing/hostedForm/publicUrlSource';
import type {
  HostedFormCreateInstanceOptions,
  HostedFormMintOptions,
} from '../../signing/hostedForm/source';
import {
  createHostedFormSource,
  resolveHostedFormCreateInstance,
} from '../../signing/hostedForm/source';
import type { SigningSource } from '../../signing/types';
import { interpretDocuSignEvent } from './events';
import type { WebFormPrefill } from './prefill';

/** The minted instance ({ url, envelopeId? }); the same shape as `HostedFormInstance`. */
export type WebFormsInstance = HostedFormInstance;

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
): (() => Promise<WebFormsInstance>) =>
  createHostedFormMinter<WebFormPrefill>(mint, prefill);

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

// Public URL: prefilled values ride in the URL, so avoid it for sensitive
// data (see docs/security notes).
export type PublicUrlSigningSourceOptions = Omit<
  HostedFormPublicUrlSourceOptions,
  'interpret'
>;

export const createPublicUrlSource = (
  options: PublicUrlSigningSourceOptions,
): SigningSource =>
  createHostedFormPublicUrlSource({
    ...options,
    interpret: interpretDocuSignEvent,
  });
