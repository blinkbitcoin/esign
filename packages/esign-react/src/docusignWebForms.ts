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

import { interpretDocuSignEvent } from '@blinkbitcoin/esignature-core';

import type {
  SigningEvent,
  SigningSession,
  SigningSourceError,
  WebFormsInstance,
} from '@blinkbitcoin/esignature-core';

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

// A source that embeds via an SDK (mount) rather than a plain iframe URL.
export interface MountableSigningSource {
  start(): Promise<SigningSession>;
  interpret(message: unknown): SigningEvent | null;
  /**
   * Mount the signing UI into `container` and forward normalized events to
   * `onEvent`. Resolves with a cleanup function (call on unmount).
   */
  mount(
    container: HTMLElement,
    onEvent: (event: SigningEvent) => void,
  ): Promise<() => void>;
}

// Capability check used by the component to pick the mount vs iframe path.
export const isMountable = (
  source: unknown,
): source is MountableSigningSource =>
  typeof (source as MountableSigningSource | null)?.mount === 'function';

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

export interface DocuSignWebFormsSourceOptions {
  /** Host-provided call that mints a prefilled Web Forms instance URL. */
  createInstance: () => Promise<WebFormsInstance>;
  /** DocuSign integration key (needed by the SDK loader). */
  integrationKey: string;
  /** 'demo' (default) or 'production' - picks the bundle.js host. */
  environment?: 'demo' | 'production';
  /** SDK display format (default 'focused'). */
  displayFormat?: string;
  /** Injectable loader (tests); defaults to loading bundle.js. */
  loadDocuSign?: LoadDocuSign;
}

export const createDocuSignWebFormsSource = (
  options: DocuSignWebFormsSourceOptions,
): MountableSigningSource => {
  /* istanbul ignore next -- the default loader path needs the real SDK (not CI) */
  const load =
    options.loadDocuSign ?? defaultLoadDocuSign(options.environment ?? 'demo');
  let resolvedUrl: string | undefined;

  return {
    async start(): Promise<SigningSession> {
      try {
        const instance = await options.createInstance();
        resolvedUrl = instance.url;
        return { url: instance.url, envelopeId: instance.envelopeId };
      } catch (error) {
        throw {
          code: 'ENVELOPE_CREATION_FAILED',
          message: error instanceof Error ? error.message : undefined,
        } as SigningSourceError;
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
