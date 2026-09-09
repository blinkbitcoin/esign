// DocuSign.js-backed Web Forms source (WEB ONLY - depends on the DOM + the
// DocuSign.js SDK, which has no React Native equivalent). Real DocuSign Web
// Forms are embedded via DocuSign.js (bundle.js), which creates the iframe and
// dispatches a `sessionEnd` event; a plain iframe does NOT receive those events
// (verified 2026-07). This source mounts via the SDK and forwards sessionEnd
// through the shared interpreter.
//
// The SDK loader is injectable so the wiring is unit-tested with a fake; the
// real loader is the only unverified surface (marked below) - confirm the exact
// DocuSign.js API (loadDocuSign / signing() / on / mount) against a live account.

import {
  interpretDocuSignEvent,
  resolveCreateInstance,
  toSigningSourceError,
} from '@blinkbitcoin/esign-core';

import type {
  MintWebFormsInstanceOptions,
  MountableSigningSource as CoreMountableSigningSource,
  SigningSession,
  WebFormPrefill,
  WebFormsInstance,
} from '@blinkbitcoin/esign-core';

// Minimal shape of the DocuSign.js SDK we rely on.
export interface DocuSignSigning {
  on(event: string, handler: (payload: unknown) => void): void;
  mount(container: HTMLElement | string): void;
  close?(): void;
}
export interface DocuSignSdk {
  signing(options: { url: string; displayFormat?: string }): DocuSignSigning;
}
export type LoadDocuSign = (integrationKey: string) => Promise<DocuSignSdk>;

// The core capability, with the web's container: a source that embeds via an
// SDK (mount) rather than a plain iframe URL. The guard is core's isMountable.
export type MountableSigningSource = CoreMountableSigningSource<HTMLElement>;
export { isMountable } from '@blinkbitcoin/esign-core';

const BUNDLE_URLS = {
  demo: 'https://js-d.docusign.com/bundle.js',
  production: 'https://js.docusign.com/bundle.js',
};

// Real loader: inject bundle.js, then call window.DocuSign.loadDocuSign.
// Not exercised in CI (needs the live SDK + a real integration key).
/* istanbul ignore next -- external script load + real DocuSign SDK */
const defaultLoadDocuSign =
  (environment: 'demo' | 'production'): LoadDocuSign =>
  async integrationKey => {
    const src = BUNDLE_URLS[environment];
    if (!document.querySelector(`script[src="${src}"]`)) {
      await new Promise<void>((resolve, reject) => {
        const script = document.createElement('script');
        script.src = src;
        script.onload = () => resolve();
        script.onerror = () => reject(new Error('Failed to load DocuSign.js'));
        document.head.appendChild(script);
      });
    }
    const sdk = (
      window as unknown as { DocuSign?: { loadDocuSign: LoadDocuSign } }
    ).DocuSign;
    if (!sdk) {
      throw new Error('DocuSign.js did not initialize');
    }
    return sdk.loadDocuSign(integrationKey);
  };

interface DocuSignWebFormsSourceBase {
  /** DocuSign integration key (needed by the SDK loader). */
  integrationKey: string;
  /** 'demo' (default) or 'production' - picks the bundle.js host. */
  environment?: 'demo' | 'production';
  /** SDK display format (default 'focused'). */
  displayFormat?: string;
  /** Injectable loader (tests); defaults to loading bundle.js. */
  loadDocuSign?: LoadDocuSign;
}

/** The host brings its own backend client. */
export interface DocuSignWebFormsCreateInstanceOptions
  extends DocuSignWebFormsSourceBase {
  /** Host-provided call that mints a prefilled Web Forms instance URL. */
  createInstance: () => Promise<WebFormsInstance>;
}

/** The host names its mint endpoint and the prefill; the source does the call. */
export interface DocuSignWebFormsMintOptions
  extends DocuSignWebFormsSourceBase {
  mint: MintWebFormsInstanceOptions;
  /** Values minted with the instance; read-only fields show them locked. */
  prefill?: WebFormPrefill;
}

export type DocuSignWebFormsSourceOptions =
  | DocuSignWebFormsCreateInstanceOptions
  | DocuSignWebFormsMintOptions;

export const createDocuSignWebFormsSource = (
  options: DocuSignWebFormsSourceOptions,
): MountableSigningSource => {
  /* istanbul ignore next -- the default loader path needs the real SDK (not CI) */
  const load =
    options.loadDocuSign ?? defaultLoadDocuSign(options.environment ?? 'demo');
  const createInstance = resolveCreateInstance(options);
  let resolvedUrl: string | undefined;

  return {
    async start(): Promise<SigningSession> {
      try {
        const instance = await createInstance();
        resolvedUrl = instance.url;
        return { url: instance.url, envelopeId: instance.envelopeId };
      } catch (error) {
        throw toSigningSourceError(error, 'ENVELOPE_CREATION_FAILED');
      }
    },

    interpret: interpretDocuSignEvent,

    async mount(container, onEvent): Promise<() => void> {
      const sdk = await load(options.integrationKey);
      const signing = sdk.signing({
        url: resolvedUrl ?? '',
        displayFormat: options.displayFormat ?? 'focused',
      });
      signing.on('sessionEnd', payload => {
        const event = interpretDocuSignEvent(payload);
        if (event) {
          onEvent(event);
        }
      });
      signing.mount(container);
      return () => signing.close?.();
    },
  };
};
