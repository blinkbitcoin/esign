import type { SigningSource } from './types';
export interface PublicUrlSigningSourceOptions {
  /** The full public form URL, including any prefill query parameters. */
  url: string;
  /** Origin to accept postMessage from (e.g. https://apps.docusign.com). */
  allowedOrigin?: string;
}
export declare const createPublicUrlSource: (
  options: PublicUrlSigningSourceOptions,
) => SigningSource;
//# sourceMappingURL=publicUrlSource.d.ts.map
