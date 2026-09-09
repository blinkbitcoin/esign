// Hosted-form signing source: a provider-hosted, prefilled form whose instance
// URL the host's backend mints (it holds the provider credentials; read-only
// fields come back locked with the values it prefilled). The host either
// points this source at that endpoint (`mint` + `prefill`) or injects its own
// `createInstance` call. Provider-neutral: the interpreter is injectable
// (default: the bridge protocol); a provider binds its own on top.
// No Apollo/GraphQL dependency.

import { interpretBridgeEvent } from '../bridge';
import { SigningSourceError, toSigningSourceError } from '../errors';
import { withTimeout } from '../withTimeout';
import { createHostedFormMinter } from './mint';

import type { SigningEvent, SigningSession, SigningSource } from '../types';
import type {
  HostedFormInstance,
  HostedFormPrefill,
  MintHostedFormOptions,
} from './mint';

export interface HostedFormSourceBase {
  /** Origin to accept postMessage from (e.g. the provider's app origin). */
  allowedOrigin?: string;
  /**
   * Give up on minting after this many milliseconds (default 30000).
   * Without it, a hung host fetch would leave the component in `loading`
   * forever - the component has no watchdog of its own. Times out with
   * code NETWORK_ERROR so the UI shows the connectivity message.
   */
  timeoutMs?: number;
  /** Reads the embedded page's messages (default: the bridge `{ event }` protocol). */
  interpret?: (message: unknown) => SigningEvent | null;
}

/** The host brings its own backend client. */
export interface HostedFormCreateInstanceOptions extends HostedFormSourceBase {
  /** Host-provided call that mints a prefilled hosted-form instance URL. */
  createInstance: () => Promise<HostedFormInstance>;
}

/** The host names its mint endpoint and the prefill; the source does the call. */
export interface HostedFormMintOptions<
  P extends HostedFormPrefill = HostedFormPrefill,
> extends HostedFormSourceBase {
  mint: MintHostedFormOptions;
  /** Values minted with the instance; read-only fields show them locked. */
  prefill?: P;
}

export type HostedFormSourceOptions<
  P extends HostedFormPrefill = HostedFormPrefill,
> = HostedFormCreateInstanceOptions | HostedFormMintOptions<P>;

const DEFAULT_TIMEOUT_MS = 30_000;

/** The createInstance call for either option shape. */
export const resolveHostedFormCreateInstance = <P extends HostedFormPrefill>(
  options: HostedFormSourceOptions<P>,
): (() => Promise<HostedFormInstance>) =>
  'createInstance' in options
    ? options.createInstance
    : createHostedFormMinter(options.mint, options.prefill);

export const createHostedFormSource = <P extends HostedFormPrefill>(
  options: HostedFormSourceOptions<P>,
): SigningSource => {
  const createInstance = resolveHostedFormCreateInstance(options);
  return {
    async start(): Promise<SigningSession> {
      const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
      try {
        const instance = await withTimeout(
          createInstance,
          timeoutMs,
          () =>
            new SigningSourceError(
              'NETWORK_ERROR',
              `Timed out creating the signing instance after ${timeoutMs}ms`,
            ),
        );
        return {
          url: instance.url,
          envelopeId: instance.envelopeId,
          allowedOrigin: options.allowedOrigin,
        };
      } catch (error) {
        // The watchdog's NETWORK_ERROR passes through; a failed mint is
        // ENVELOPE_CREATION_FAILED with the reason
        throw toSigningSourceError(error, 'ENVELOPE_CREATION_FAILED');
      }
    },

    interpret: options.interpret ?? interpretBridgeEvent,
  };
};
