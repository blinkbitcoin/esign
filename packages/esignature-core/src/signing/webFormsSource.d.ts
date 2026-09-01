import type { SigningSource } from './types';
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
export declare const createWebFormsSource: (
  options: WebFormsSigningSourceOptions,
) => SigningSource;
//# sourceMappingURL=webFormsSource.d.ts.map
