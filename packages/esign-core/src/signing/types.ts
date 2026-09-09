// The signing-source abstraction: the seam that lets one <ESignature>
// component drive any acquisition + event protocol (proxy envelope, DocuSign
// Web Forms API-embedded, or a public Web Forms URL).
//
// Platform-agnostic (no React, no WebView/iframe) - identical in the web
// package. Only the component that embeds the URL differs per platform.

/** Normalized signing outcome the component acts on, regardless of provider. */
export interface SigningEvent {
  type: 'complete' | 'cancel' | 'decline' | 'sessionExpired' | 'error';
  /** Present when the provider reports it in the completion event. */
  envelopeId?: string;
  /** Error code (type === 'error') - mapped to a message by the component. */
  code?: string;
  /** Raw provider message for validation-style errors. */
  message?: string;
}

/** A resolved signing session: the URL to embed plus its metadata. */
export interface SigningSession {
  /** URL to load in the WebView/iframe. */
  url: string;
  /** Set by sources that create an envelope; used for onComplete + restart. */
  envelopeId?: string;
  /** Origin to accept postMessage from (web origin checking / defense in depth). */
  allowedOrigin?: string;
}

/** Rejection shape from start()/restart() so the component can show a code. */
export interface SigningSourceError {
  code: string;
  /** Raw provider message, if any. */
  message?: string;
}

/**
 * A signing mode: knows how to acquire its URL and read its own events.
 * Adding a new provider = a new SigningSource; the component never changes
 * (Open/Closed). start()/restart() reject with a SigningSourceError.
 */
export interface SigningSource {
  /** Acquire the signing session (create envelope / mint instance / return URL). */
  start(): Promise<SigningSession>;
  /**
   * Translate a raw embedded-page message into a normalized event, or null
   * if it isn't a recognized signing event.
   */
  interpret(message: unknown): SigningEvent | null;
}

/** A source that supports session-expiry restart (not all do). */
export interface RestartableSigningSource extends SigningSource {
  restart(previous: SigningSession): Promise<SigningSession>;
}

/**
 * A source that embeds via an SDK (mount) rather than a plain iframe/WebView
 * URL. `C` is the platform's container (an HTMLElement on the web).
 */
export interface MountableSigningSource<C = unknown> extends SigningSource {
  /**
   * Mount the signing UI into `container` and forward normalized events to
   * `onEvent`. Resolves with a cleanup function (call on unmount).
   */
  mount(
    container: C,
    onEvent: (event: SigningEvent) => void,
  ): Promise<() => void>;
}

// Optional capabilities are duck-typed: a source has one when it implements
// the method. One check backs every guard so they cannot drift apart.
const hasCapability = (source: unknown, method: string): boolean =>
  typeof (source as Record<string, unknown> | null | undefined)?.[method] ===
  'function';

/** Capability check - lets the component offer restart only when supported. */
export const isRestartable = (
  source: SigningSource,
): source is RestartableSigningSource => hasCapability(source, 'restart');

/** Capability check - lets the component pick the mount path over the URL embed. */
export const isMountable = <C = unknown>(
  source: unknown,
): source is MountableSigningSource<C> => hasCapability(source, 'mount');
