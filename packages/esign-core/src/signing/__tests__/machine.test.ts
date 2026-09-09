import { SigningSourceError } from '../errors';
import type { SigningMachineState } from '../machine';
import {
  acquireSession,
  initialSigningState,
  resolveRestart,
  transition,
} from '../machine';
import { getErrorMessage } from '../messages';
import type { SigningSession, SigningSource } from '../types';

const session: SigningSession = {
  url: 'https://sign.example/s',
  envelopeId: 'env-1',
  allowedOrigin: 'https://sign.example',
};

const signing = (): SigningMachineState => ({
  status: 'signing',
  error: null,
  signingUrl: session.url,
  session,
});

describe('initialSigningState', () => {
  it('starts idle with nothing, or from the test seeds', () => {
    expect(initialSigningState()).toEqual({
      status: 'idle',
      error: null,
      signingUrl: null,
      session: null,
    });
    expect(
      initialSigningState({
        __testInitialStatus: 'error',
        __testSession: session,
      }),
    ).toEqual({
      status: 'error',
      error: null,
      signingUrl: session.url,
      session,
    });
    // A bare URL seed becomes a minimal session
    expect(initialSigningState({ __testSigningUrl: 'https://u' })).toEqual({
      status: 'idle',
      error: null,
      signingUrl: 'https://u',
      session: { url: 'https://u' },
    });
  });
});

describe('transition: acquiring a session', () => {
  it('goes loading, then signing with the session and its url', () => {
    const loading = transition(initialSigningState(), { type: 'acquire' });
    expect(loading).toEqual({
      state: {
        status: 'loading',
        error: null,
        signingUrl: null,
        session: null,
      },
      effects: [],
    });
    expect(transition(loading.state, { type: 'acquired', session })).toEqual({
      state: signing(),
      effects: [],
    });
  });

  it('maps a failed acquisition to an error state and an onError effect', () => {
    const coded = transition(
      { ...initialSigningState(), status: 'loading' },
      {
        type: 'acquireFailed',
        error: new SigningSourceError('VALIDATION_ERROR', 'Bad email'),
      },
    );
    expect(coded.state).toMatchObject({
      status: 'error',
      signingUrl: null,
      session: null,
    });
    expect(coded.effects).toEqual([
      {
        type: 'error',
        error: { code: 'VALIDATION_ERROR', message: 'Bad email' },
      },
    ]);
    // A plain wire-shaped rejection keeps its code; anything else is UNKNOWN_ERROR
    expect(
      transition(initialSigningState(), {
        type: 'acquireFailed',
        error: { code: 'X' },
      }).state.error,
    ).toEqual({ code: 'X', message: getErrorMessage('X') });
    expect(
      transition(initialSigningState(), {
        type: 'acquireFailed',
        error: undefined,
      }).state.error,
    ).toEqual({
      code: 'UNKNOWN_ERROR',
      message: getErrorMessage('UNKNOWN_ERROR'),
    });
  });

  it('keeps the previous session on a failed restart (a second restart can try again)', () => {
    const result = transition(
      { ...signing(), status: 'loading' },
      { type: 'acquireFailed', error: new Error('boom') },
    );
    expect(result.state.session).toEqual(session);
  });
});

describe('transition: page events', () => {
  it('complete: success plus a complete effect carrying the envelope id', () => {
    const fromEvent = transition(signing(), {
      type: 'event',
      event: { type: 'complete', envelopeId: 'from-event' },
    });
    expect(fromEvent.state).toMatchObject({
      status: 'success',
      signingUrl: session.url,
    });
    expect(fromEvent.effects).toEqual([
      {
        type: 'complete',
        result: { envelopeId: 'from-event', status: 'completed' },
      },
    ]);
    // Falls back to the session's id, and to none at all
    expect(
      transition(signing(), { type: 'event', event: { type: 'complete' } })
        .effects[0],
    ).toEqual({
      type: 'complete',
      result: { envelopeId: 'env-1', status: 'completed' },
    });
    expect(
      transition(
        { ...signing(), session: { url: 'u' } },
        { type: 'event', event: { type: 'complete' } },
      ).effects[0],
    ).toEqual({
      type: 'complete',
      result: { envelopeId: undefined, status: 'completed' },
    });
  });

  it('settled clears the url once the success screen has been shown', () => {
    const success = transition(signing(), {
      type: 'event',
      event: { type: 'complete' },
    });
    expect(transition(success.state, { type: 'settled' })).toEqual({
      state: { ...success.state, signingUrl: null },
      effects: [],
    });
  });

  it.each(['cancel', 'decline'] as const)(
    '%s: back to idle, session dropped, onCancel',
    type => {
      expect(transition(signing(), { type: 'event', event: { type } })).toEqual(
        {
          state: {
            status: 'idle',
            error: null,
            signingUrl: null,
            session: null,
          },
          effects: [{ type: 'cancel' }],
        },
      );
    },
  );

  it('sessionExpired: error state that KEEPS the session for restart', () => {
    const message = getErrorMessage('SESSION_EXPIRED');
    expect(
      transition(signing(), {
        type: 'event',
        event: { type: 'sessionExpired' },
      }),
    ).toEqual({
      state: {
        status: 'error',
        error: { code: 'SESSION_EXPIRED', message },
        signingUrl: null,
        session,
      },
      effects: [{ type: 'error', error: { code: 'SESSION_EXPIRED', message } }],
    });
  });

  it('error: the event code and message, with fallbacks, session dropped', () => {
    expect(
      transition(signing(), {
        type: 'event',
        event: { type: 'error', code: 'PROVIDER_UNAVAILABLE', message: 'down' },
      }),
    ).toEqual({
      state: {
        status: 'error',
        error: { code: 'PROVIDER_UNAVAILABLE', message: 'down' },
        signingUrl: null,
        session: null,
      },
      effects: [
        {
          type: 'error',
          error: { code: 'PROVIDER_UNAVAILABLE', message: 'down' },
        },
      ],
    });
    expect(
      transition(signing(), { type: 'event', event: { type: 'error' } }).state
        .error,
    ).toEqual({
      code: 'SIGNING_ERROR',
      message: getErrorMessage('SIGNING_ERROR'),
    });
  });
});

describe('transition: connectivity, retry, restart', () => {
  it('offline and online only move the status', () => {
    const offline = transition(initialSigningState(), { type: 'offline' });
    expect(offline).toEqual({
      state: { ...initialSigningState(), status: 'offline' },
      effects: [],
    });
    expect(transition(offline.state, { type: 'online' }).state.status).toBe(
      'idle',
    );
  });

  it('retry clears everything and returns to idle', () => {
    const errored = transition(signing(), {
      type: 'event',
      event: { type: 'sessionExpired' },
    });
    expect(transition(errored.state, { type: 'retry' })).toEqual({
      state: { status: 'idle', error: null, signingUrl: null, session: null },
      effects: [],
    });
  });

  it('restart clears the error and keeps the session (the acquisition follows)', () => {
    const errored = transition(signing(), {
      type: 'event',
      event: { type: 'sessionExpired' },
    });
    expect(transition(errored.state, { type: 'restart' }).state).toEqual({
      ...errored.state,
      error: null,
    });
  });
});

describe('acquireSession', () => {
  it('turns the acquisition into the action it ends in, never throwing', async () => {
    await expect(
      acquireSession(() => Promise.resolve(session)),
    ).resolves.toEqual({
      type: 'acquired',
      session,
    });
    const error = new SigningSourceError('ENVELOPE_CREATION_FAILED');
    await expect(acquireSession(() => Promise.reject(error))).resolves.toEqual({
      type: 'acquireFailed',
      error,
    });
  });
});

describe('resolveRestart', () => {
  const plain: SigningSource = {
    start: () => Promise.resolve(session),
    interpret: () => null,
  };
  const restart = jest.fn(() => Promise.resolve({ url: 'https://again' }));
  const restartable = { ...plain, restart };

  it('is null for a source that cannot restart, or without a kept session', () => {
    expect(resolveRestart(plain, session)).toBeNull();
    expect(resolveRestart(restartable, null)).toBeNull();
  });

  it('otherwise restarts the kept session', async () => {
    const acquire = resolveRestart(restartable, session);
    await expect(acquire?.()).resolves.toEqual({ url: 'https://again' });
    expect(restart).toHaveBeenCalledWith(session);
  });
});
