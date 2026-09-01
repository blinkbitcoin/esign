// DocuSign Web Forms (API-embedded) signing source. The host injects a single
// async call that hits its own thin backend endpoint (which holds the DocuSign
// credentials and calls Instances:createInstance with prefill values). No
// Apollo/GraphQL dependency.

import { interpretDocuSignEvent } from './events';

import type {
  SigningSession,
  SigningSource,
  SigningSourceError,
} from './types';

export interface WebFormsInstance {
  /** Embeddable instance URL (formUrl#instanceToken=...). */
  url: string;
  /** Optional envelope/instance id echoed back to onComplete. */
  envelopeId?: string;
}

export interface WebFormsSigningSourceOptions {
  /** Host-provided call that mints a prefilled Web Forms instance URL. */
  createInstance: () => Promise<WebFormsInstance>;
  /** Origin to accept postMessage from (e.g. https://apps.docusign.com). */
  allowedOrigin?: string;
  /**
   * Give up on createInstance after this many milliseconds (default 30000).
   * Without it, a hung host fetch would leave the component in `loading`
   * forever - the component has no watchdog of its own. Times out with
   * code NETWORK_ERROR so the UI shows the connectivity message.
   */
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 30_000;

export const createWebFormsSource = (
  options: WebFormsSigningSourceOptions,
): SigningSource => ({
  async start(): Promise<SigningSession> {
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const instance = await Promise.race([
        options.createInstance(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            reject({
              code: 'NETWORK_ERROR',
              message: `Timed out creating the signing instance after ${timeoutMs}ms`,
            } as SigningSourceError);
          }, timeoutMs);
        }),
      ]);
      return {
        url: instance.url,
        envelopeId: instance.envelopeId,
        allowedOrigin: options.allowedOrigin,
      };
    } catch (error) {
      if ((error as SigningSourceError)?.code === 'NETWORK_ERROR') {
        throw error;
      }
      throw {
        code: 'ENVELOPE_CREATION_FAILED',
        message: error instanceof Error ? error.message : undefined,
      } as SigningSourceError;
    } finally {
      clearTimeout(timer);
    }
  },

  interpret: interpretDocuSignEvent,
});
