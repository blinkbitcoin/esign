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
}

export const createWebFormsSource = (
  options: WebFormsSigningSourceOptions,
): SigningSource => ({
  async start(): Promise<SigningSession> {
    try {
      const instance = await options.createInstance();
      return {
        url: instance.url,
        envelopeId: instance.envelopeId,
        allowedOrigin: options.allowedOrigin,
      };
    } catch (error) {
      throw {
        code: 'ENVELOPE_CREATION_FAILED',
        message: error instanceof Error ? error.message : undefined,
      } as SigningSourceError;
    }
  },

  interpret: interpretDocuSignEvent,
});
