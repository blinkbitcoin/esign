// DocuSign Web Forms (API-embedded) signing source. The host's backend mints
// the instance (it holds the DocuSign credentials; read-only fields come
// back locked with the values it prefilled). The host either points this
// source at that endpoint (`mint` + `prefill`) or injects its own
// `createInstance` call. No Apollo/GraphQL dependency.

import { SigningSourceError, toSigningSourceError } from './errors';
import { interpretDocuSignEvent } from './events';
import { createWebFormsMinter } from './mint';

import type { MintWebFormsInstanceOptions, WebFormPrefill } from './mint';
import type { SigningSession, SigningSource } from './types';

export interface WebFormsInstance {
  /** Embeddable instance URL (formUrl#instanceToken=...). */
  url: string;
  /** Optional envelope/instance id echoed back to onComplete. */
  envelopeId?: string;
}

interface WebFormsSigningSourceBase {
  /** Origin to accept postMessage from (e.g. https://apps.docusign.com). */
  allowedOrigin?: string;
  /**
   * Give up on minting after this many milliseconds (default 30000).
   * Without it, a hung host fetch would leave the component in `loading`
   * forever - the component has no watchdog of its own. Times out with
   * code NETWORK_ERROR so the UI shows the connectivity message.
   */
  timeoutMs?: number;
}

/** The host brings its own backend client. */
export interface WebFormsCreateInstanceOptions
  extends WebFormsSigningSourceBase {
  /** Host-provided call that mints a prefilled Web Forms instance URL. */
  createInstance: () => Promise<WebFormsInstance>;
}

/** The host names its mint endpoint and the prefill; the source does the call. */
export interface WebFormsMintOptions extends WebFormsSigningSourceBase {
  mint: MintWebFormsInstanceOptions;
  /** Values minted with the instance; read-only fields show them locked. */
  prefill?: WebFormPrefill;
}

export type WebFormsSigningSourceOptions =
  | WebFormsCreateInstanceOptions
  | WebFormsMintOptions;

const DEFAULT_TIMEOUT_MS = 30_000;

/** The createInstance call for either option shape. */
export const resolveCreateInstance = (
  options: WebFormsSigningSourceOptions,
): (() => Promise<WebFormsInstance>) =>
  'createInstance' in options
    ? options.createInstance
    : createWebFormsMinter(options.mint, options.prefill);

export const createWebFormsSource = (
  options: WebFormsSigningSourceOptions,
): SigningSource => {
  const createInstance = resolveCreateInstance(options);
  return {
    async start(): Promise<SigningSession> {
      const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const instance = await Promise.race([
          createInstance(),
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => {
              reject(
                new SigningSourceError(
                  'NETWORK_ERROR',
                  `Timed out creating the signing instance after ${timeoutMs}ms`,
                ),
              );
            }, timeoutMs);
          }),
        ]);
        return {
          url: instance.url,
          envelopeId: instance.envelopeId,
          allowedOrigin: options.allowedOrigin,
        };
      } catch (error) {
        // The watchdog's NETWORK_ERROR passes through; a failed mint is
        // ENVELOPE_CREATION_FAILED with the reason
        throw toSigningSourceError(error, 'ENVELOPE_CREATION_FAILED');
      } finally {
        clearTimeout(timer);
      }
    },

    // Understands both the DocuSign.js `sessionEnd` shape and the return-URL
    // bridge's `{ event }` shape, so a real form finishing via returnUrl in a
    // plain WebView/iframe is read the same way as one embedded via DocuSign.js
    interpret: interpretDocuSignEvent,
  };
};
