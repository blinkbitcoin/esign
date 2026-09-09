// Public-URL hosted-form source: a published form link, prefilled via URL
// query parameters. No backend, no credentials. The simplest mode - the
// component just embeds the URL. Note prefilled values ride in the URL, so
// avoid it for sensitive data (see docs/security notes). Provider-neutral:
// the interpreter is injectable (default: the bridge protocol).

import { interpretBridgeEvent } from '../bridge';

import type { SigningEvent, SigningSession, SigningSource } from '../types';

export interface HostedFormPublicUrlSourceOptions {
  /** The full public form URL, including any prefill query parameters. */
  url: string;
  /** Origin to accept postMessage from (e.g. the provider's app origin). */
  allowedOrigin?: string;
  /** Reads the embedded page's messages (default: the bridge `{ event }` protocol). */
  interpret?: (message: unknown) => SigningEvent | null;
}

export const createHostedFormPublicUrlSource = (
  options: HostedFormPublicUrlSourceOptions,
): SigningSource => ({
  async start(): Promise<SigningSession> {
    return { url: options.url, allowedOrigin: options.allowedOrigin };
  },

  interpret: options.interpret ?? interpretBridgeEvent,
});
