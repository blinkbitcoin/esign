// The signing state machine, once, for both platforms. Pure: no React, no
// timers, no I/O. A platform hook (React Native, web) keeps the state in a
// useState, feeds actions to `transition`, and runs the returned effects
// (fire a host callback, hold the success screen). What differs per platform
// - the connectivity probe, how page messages arrive, how the session is
// embedded - stays in the hook.

import { toSigningSourceError } from './errors';
import { getErrorMessage } from './messages';
import type { SigningEvent, SigningSession, SigningSource } from './types';
import { isRestartable } from './types';

/** Signing-flow status - use instead of multiple boolean flags. */
export type ESignatureStatus =
  | 'idle'
  | 'loading'
  | 'signing'
  | 'success'
  | 'error'
  | 'offline';

/** Error information for signing failures. */
export type ESignatureError = {
  code: string;
  message: string;
};

/**
 * Result returned on successful signing completion. envelopeId is optional
 * because some sources (e.g. a public Web Form URL) don't surface one.
 */
export type ESignatureResult = {
  envelopeId?: string;
  status: 'completed';
};

/** The host callbacks every signing UI takes. */
export interface SigningCallbacks {
  onComplete: (result: ESignatureResult) => void;
  onError: (error: ESignatureError) => void;
  onCancel: () => void;
}

/** What the hook renders from. `session` is the active session (URL, envelopeId, allowedOrigin). */
export interface SigningMachineState {
  status: ESignatureStatus;
  error: ESignatureError | null;
  signingUrl: string | null;
  /**
   * Kept across a session expiry so a restartable source can resume it;
   * cleared on cancel, decline, error and retry.
   */
  session: SigningSession | null;
}

/** Everything that can happen to the flow. */
export type SigningAction =
  /** A session is being acquired (start or restart). */
  | { type: 'acquire' }
  | { type: 'acquired'; session: SigningSession }
  | { type: 'acquireFailed'; error: unknown }
  /** A normalized event from the signing page or the SDK. */
  | { type: 'event'; event: SigningEvent }
  /** The success screen has been shown for its delay; onComplete fired. */
  | { type: 'settled' }
  | { type: 'offline' }
  | { type: 'online' }
  | { type: 'retry' }
  | { type: 'restart' };

/** Side effects for the hook to run after a transition, in order. */
export type SigningEffect =
  /** Hold the success screen for the configured delay, then fire onComplete and dispatch `settled`. */
  | { type: 'complete'; result: ESignatureResult }
  | { type: 'error'; error: ESignatureError }
  | { type: 'cancel' };

/** The test-only seeds the hooks accept. */
export interface SigningStateSeed {
  __testInitialStatus?: ESignatureStatus;
  __testSigningUrl?: string;
  __testSession?: SigningSession;
}

export const initialSigningState = (
  seed: SigningStateSeed = {},
): SigningMachineState => ({
  status: seed.__testInitialStatus ?? 'idle',
  error: null,
  signingUrl: seed.__testSigningUrl ?? seed.__testSession?.url ?? null,
  session:
    seed.__testSession ??
    (seed.__testSigningUrl ? { url: seed.__testSigningUrl } : null),
});

const failed = (
  state: SigningMachineState,
  error: ESignatureError,
  session: SigningSession | null,
): { state: SigningMachineState; effects: SigningEffect[] } => ({
  state: { ...state, status: 'error', error, signingUrl: null, session },
  effects: [{ type: 'error', error }],
});

const onEvent = (
  state: SigningMachineState,
  event: SigningEvent,
): { state: SigningMachineState; effects: SigningEffect[] } => {
  switch (event.type) {
    case 'complete':
      return {
        state: { ...state, status: 'success' },
        effects: [
          {
            type: 'complete',
            result: {
              // Prefer an id from the event; fall back to the session's
              envelopeId: event.envelopeId ?? state.session?.envelopeId,
              status: 'completed',
            },
          },
        ],
      };
    case 'cancel':
    case 'decline':
      return {
        state: { ...state, status: 'idle', signingUrl: null, session: null },
        effects: [{ type: 'cancel' }],
      };
    case 'sessionExpired': {
      // The session is kept: a restartable source resumes it
      const code = 'SESSION_EXPIRED';
      return failed(
        state,
        { code, message: getErrorMessage(code) },
        state.session,
      );
    }
    case 'error': {
      const code = event.code ?? 'SIGNING_ERROR';
      return failed(
        state,
        { code, message: event.message ?? getErrorMessage(code) },
        null,
      );
    }
  }
};

/**
 * The one transition function. Returns the next state and the effects the
 * hook must run; never mutates. No status guards: the hooks never had any,
 * and the test seeds rely on entering any state directly.
 */
export const transition = (
  state: SigningMachineState,
  action: SigningAction,
): { state: SigningMachineState; effects: SigningEffect[] } => {
  switch (action.type) {
    case 'acquire':
      return { state: { ...state, status: 'loading' }, effects: [] };
    case 'acquired':
      return {
        state: {
          ...state,
          status: 'signing',
          signingUrl: action.session.url,
          session: action.session,
        },
        effects: [],
      };
    case 'acquireFailed': {
      const sourceError = toSigningSourceError(action.error, 'UNKNOWN_ERROR');
      const code = sourceError.code;
      const message = getErrorMessage(code, sourceError.message);
      return failed(state, { code, message }, state.session);
    }
    case 'event':
      return onEvent(state, action.event);
    case 'settled':
      return { state: { ...state, signingUrl: null }, effects: [] };
    case 'offline':
      return { state: { ...state, status: 'offline' }, effects: [] };
    case 'online':
      return { state: { ...state, status: 'idle' }, effects: [] };
    case 'retry':
      return {
        state: {
          ...state,
          status: 'idle',
          error: null,
          signingUrl: null,
          session: null,
        },
        effects: [],
      };
    case 'restart':
      return { state: { ...state, error: null }, effects: [] };
  }
};

/**
 * Run an acquisition (start or restart) and hand back the action it ends
 * in - never throws, so a hook can `await` it and dispatch the result.
 */
export const acquireSession = async (
  acquire: () => Promise<SigningSession>,
): Promise<SigningAction> => {
  try {
    return { type: 'acquired', session: await acquire() };
  } catch (error) {
    return { type: 'acquireFailed', error };
  }
};

/**
 * The restart acquisition for a source and its preserved session, or null
 * when there is nothing to restart (the source cannot, or no session was
 * kept) - the hook then falls back to a plain retry.
 */
export const resolveRestart = (
  source: SigningSource,
  session: SigningSession | null,
): (() => Promise<SigningSession>) | null =>
  isRestartable(source) && session ? () => source.restart(session) : null;
