// Public-URL signing source: a published DocuSign Web Form link, prefilled via
// URL query parameters. No backend, no credentials. The simplest mode - the
// component just embeds the URL. Note prefilled values ride in the URL, so
// avoid it for sensitive data (see docs/security notes).

import { interpretDocuSignEvent } from './events';

import type { SigningSession, SigningSource } from './types';

export interface PublicUrlSigningSourceOptions {
  /** The full public form URL, including any prefill query parameters. */
  url: string;
  /** Origin to accept postMessage from (e.g. https://apps.docusign.com). */
  allowedOrigin?: string;
}

export const createPublicUrlSource = (
  options: PublicUrlSigningSourceOptions,
): SigningSource => ({
  async start(): Promise<SigningSession> {
    return { url: options.url, allowedOrigin: options.allowedOrigin };
  },

  interpret: interpretDocuSignEvent,
});
