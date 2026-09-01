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
/** Capability check - lets the component offer restart only when supported. */
export declare const isRestartable: (
  source: SigningSource,
) => source is RestartableSigningSource;
//# sourceMappingURL=types.d.ts.map
