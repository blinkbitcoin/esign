/**
 * useESignature (web) hook tests - the headless state machine, source-driven.
 *
 * Signing-page events are dispatched as window MessageEvents (the iframe
 * protocol) or through the DocuSign.js mount callback. The default UI's
 * wiring is covered in ESignature.test.tsx.
 */

import { act, renderHook, waitFor } from '@testing-library/react';
import React from 'react';

import { useESignature } from '../useESignature';
import { interpretProxyEvent } from '@blinkbitcoin/esign-core';

import type { SigningSource, SigningSession } from '@blinkbitcoin/esign-core';
import type { UseESignatureOptions } from '../types';

const okSession: SigningSession = {
  url: 'https://sign/1',
  envelopeId: 'env-1',
  allowedOrigin: 'https://signing.test',
};

const makeSource = (overrides: Partial<SigningSource> = {}): SigningSource => ({
  start: jest.fn().mockResolvedValue(okSession),
  interpret: interpretProxyEvent,
  ...overrides,
});

const makeRestartable = (overrides = {}) => ({
  start: jest.fn().mockResolvedValue(okSession),
  interpret: interpretProxyEvent,
  restart: jest.fn().mockResolvedValue({ ...okSession, url: 'https://sign/2' }),
  ...overrides,
});

const callbacks = {
  onComplete: jest.fn(),
  onError: jest.fn(),
  onCancel: jest.fn(),
};

const postSigningMessage = (data: unknown, origin = 'https://signing.test') =>
  act(() => {
    window.dispatchEvent(new MessageEvent('message', { data, origin }));
  });

const render = (options: UseESignatureOptions, strict = false) =>
  renderHook(() => useESignature(options), {
    wrapper: strict ? React.StrictMode : undefined,
  });

const signingOptions = (overrides: Partial<UseESignatureOptions> = {}) => ({
  ...callbacks,
  source: makeSource(),
  __testInitialStatus: 'signing' as const,
  __testSession: okSession,
  ...overrides,
});

let onLineSpy: jest.SpyInstance;

beforeEach(() => {
  jest.clearAllMocks();
  onLineSpy = jest
    .spyOn(window.navigator, 'onLine', 'get')
    .mockReturnValue(true);
});

afterEach(() => {
  onLineSpy.mockRestore();
});

describe('initial state', () => {
  it('starts idle with no error and no embed', () => {
    const { result } = render({ ...callbacks, source: makeSource() });
    expect(result.current.status).toBe('idle');
    expect(result.current.error).toBeNull();
    expect(result.current.signingUrl).toBeNull();
    expect(result.current.isSessionExpired).toBe(false);
    expect(result.current.embed).toBeNull();
  });

  it('seeds signing from __testSigningUrl and exposes iframe props', () => {
    const { result } = render({
      ...callbacks,
      source: makeSource(),
      __testInitialStatus: 'signing',
      __testSigningUrl: 'https://sign/x',
    });
    expect(result.current.embed).toEqual({
      kind: 'iframe',
      iframeProps: { src: 'https://sign/x', title: 'Document signing' },
    });
  });

  it('signing without a URL has no embed', () => {
    const { result } = render({
      ...callbacks,
      source: makeSource(),
      __testInitialStatus: 'signing',
    });
    expect(result.current.status).toBe('signing');
    expect(result.current.embed).toBeNull();
  });
});

describe('sign (acquisition)', () => {
  it('reaches signing under React.StrictMode (guard re-arms after double-mount)', async () => {
    const { result } = render({ ...callbacks, source: makeSource() }, true);
    await act(async () => {
      await result.current.sign();
    });
    expect(result.current.status).toBe('signing');
  });

  it('goes offline without calling the source', async () => {
    onLineSpy.mockReturnValue(false);
    const source = makeSource();
    const { result } = render({ ...callbacks, source });
    await act(async () => {
      await result.current.sign();
    });
    expect(result.current.status).toBe('offline');
    expect(source.start).not.toHaveBeenCalled();
    expect(callbacks.onError).not.toHaveBeenCalled();
  });

  it('starts the source and enters signing with iframe props', async () => {
    const source = makeSource();
    const { result } = render({ ...callbacks, source });
    await act(async () => {
      await result.current.sign();
    });
    expect(source.start).toHaveBeenCalledTimes(1);
    expect(result.current.status).toBe('signing');
    expect(result.current.signingUrl).toBe('https://sign/1');
    expect(result.current.embed?.kind).toBe('iframe');
  });

  it('passes through loading while the source starts', async () => {
    let resolveStart!: (s: SigningSession) => void;
    const source = makeSource({
      start: jest.fn().mockReturnValue(
        new Promise<SigningSession>(resolve => {
          resolveStart = resolve;
        }),
      ),
    });
    const { result } = render({ ...callbacks, source });
    act(() => {
      result.current.sign();
    });
    expect(result.current.status).toBe('loading');
    await act(async () => resolveStart(okSession));
    expect(result.current.status).toBe('signing');
  });

  it('ignores a start() that settles after unmount (no state update, no callbacks)', async () => {
    let resolveStart!: (s: SigningSession) => void;
    const source = makeSource({
      start: jest.fn().mockReturnValue(
        new Promise<SigningSession>(resolve => {
          resolveStart = resolve;
        }),
      ),
    });
    const { result, unmount } = render({ ...callbacks, source });
    act(() => {
      result.current.sign();
    });
    unmount();
    await act(async () => resolveStart(okSession));
    expect(callbacks.onError).not.toHaveBeenCalled();
    expect(callbacks.onComplete).not.toHaveBeenCalled();
  });

  it('ignores a start() rejection after unmount (onError not fired)', async () => {
    let rejectStart!: (e: unknown) => void;
    const source = makeSource({
      start: jest.fn().mockReturnValue(
        new Promise<SigningSession>((_resolve, reject) => {
          rejectStart = reject;
        }),
      ),
    });
    const { result, unmount } = render({ ...callbacks, source });
    act(() => {
      result.current.sign();
    });
    unmount();
    await act(async () => rejectStart({ code: 'PROVIDER_UNAVAILABLE' }));
    expect(callbacks.onError).not.toHaveBeenCalled();
  });

  it('enters error and calls onError when start rejects', async () => {
    const source = makeSource({
      start: jest.fn().mockRejectedValue({ code: 'PROVIDER_UNAVAILABLE' }),
    });
    const { result } = render({ ...callbacks, source });
    await act(async () => {
      await result.current.sign();
    });
    expect(result.current.status).toBe('error');
    expect(result.current.error?.message).toContain(
      'Signing service temporarily unavailable',
    );
    expect(callbacks.onError).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'PROVIDER_UNAVAILABLE' }),
    );
  });

  it('falls back to UNKNOWN_ERROR when the rejection has no code', async () => {
    const source = makeSource({
      start: jest.fn().mockRejectedValue(new Error('x')),
    });
    const { result } = render({ ...callbacks, source });
    await act(async () => {
      await result.current.sign();
    });
    expect(callbacks.onError).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'UNKNOWN_ERROR' }),
    );
  });
});

describe('signing-page events + origin pinning', () => {
  it('ignores messages from a non-allowed origin', () => {
    const { result } = render(signingOptions());
    postSigningMessage({ event: 'cancel' }, 'https://evil.test');
    expect(result.current.status).toBe('signing');
    expect(callbacks.onCancel).not.toHaveBeenCalled();
  });

  it('accepts any origin when the session has none pinned', () => {
    const { result } = render(
      signingOptions({ __testSession: { url: 'https://sign/1' } }),
    );
    postSigningMessage({ event: 'cancel' }, 'https://anywhere.test');
    expect(result.current.status).toBe('idle');
  });

  it('complete → success then onComplete with the session envelopeId', () => {
    jest.useFakeTimers();
    const { result } = render(signingOptions());
    postSigningMessage({ event: 'signing_complete' });
    expect(result.current.status).toBe('success');
    expect(callbacks.onComplete).not.toHaveBeenCalled();
    act(() => jest.advanceTimersByTime(1500));
    expect(callbacks.onComplete).toHaveBeenCalledWith({
      envelopeId: 'env-1',
      status: 'completed',
    });
    expect(result.current.signingUrl).toBeNull();
    jest.useRealTimers();
  });

  it('honors a custom successDelayMs', () => {
    jest.useFakeTimers();
    render(signingOptions({ successDelayMs: 100 }));
    postSigningMessage({ event: 'signing_complete' });
    act(() => jest.advanceTimersByTime(99));
    expect(callbacks.onComplete).not.toHaveBeenCalled();
    act(() => jest.advanceTimersByTime(1));
    expect(callbacks.onComplete).toHaveBeenCalledTimes(1);
    jest.useRealTimers();
  });

  it('complete prefers an envelopeId carried in the event', () => {
    jest.useFakeTimers();
    render(
      signingOptions({
        source: makeSource({
          interpret: () => ({ type: 'complete', envelopeId: 'from-event' }),
        }),
      }),
    );
    postSigningMessage({ anything: true });
    act(() => jest.advanceTimersByTime(1500));
    expect(callbacks.onComplete).toHaveBeenCalledWith({
      envelopeId: 'from-event',
      status: 'completed',
    });
    jest.useRealTimers();
  });

  it('accepts a JSON-string payload (the mock page posts text)', () => {
    jest.useFakeTimers();
    render(signingOptions());
    postSigningMessage(JSON.stringify({ event: 'signing_complete' }));
    act(() => jest.advanceTimersByTime(1500));
    expect(callbacks.onComplete).toHaveBeenCalledWith({
      envelopeId: 'env-1',
      status: 'completed',
    });
    jest.useRealTimers();
  });

  it.each(['cancel', 'decline'])('%s → idle and onCancel', event => {
    const { result } = render(signingOptions());
    postSigningMessage({ event });
    expect(result.current.status).toBe('idle');
    expect(result.current.embed).toBeNull();
    expect(callbacks.onCancel).toHaveBeenCalledTimes(1);
  });

  it('session_timeout → error flagged as session expired', () => {
    const { result } = render(signingOptions());
    postSigningMessage({ event: 'session_timeout' });
    expect(result.current.status).toBe('error');
    expect(result.current.isSessionExpired).toBe(true);
    expect(callbacks.onError).toHaveBeenCalledWith({
      code: 'SESSION_EXPIRED',
      message: 'Session expired, tap to restart',
    });
  });

  it('exception → error with the raw message', () => {
    const { result } = render(signingOptions());
    postSigningMessage({ event: 'exception', message: 'kaboom' });
    expect(result.current.error).toEqual({
      code: 'SIGNING_ERROR',
      message: 'kaboom',
    });
    expect(result.current.isSessionExpired).toBe(false);
    expect(callbacks.onError).toHaveBeenCalledWith({
      code: 'SIGNING_ERROR',
      message: 'kaboom',
    });
  });

  it('error event with no code/message uses fallbacks', () => {
    render(
      signingOptions({
        source: makeSource({ interpret: () => ({ type: 'error' }) }),
      }),
    );
    postSigningMessage({ x: 1 });
    expect(callbacks.onError).toHaveBeenCalledWith({
      code: 'SIGNING_ERROR',
      message: 'An error occurred. Please try again.',
    });
  });

  it('ignores unrelated messages (interpret returns null)', () => {
    const { result } = render(signingOptions());
    postSigningMessage({ hello: 'world' });
    postSigningMessage('not json');
    expect(result.current.status).toBe('signing');
    expect(callbacks.onError).not.toHaveBeenCalled();
  });

  it('removes the window listener when signing ends', () => {
    const { result } = render(signingOptions());
    postSigningMessage({ event: 'cancel' }); // → idle, listener removed
    postSigningMessage({ event: 'signing_complete' }); // ignored now
    expect(result.current.status).toBe('idle');
    expect(callbacks.onComplete).not.toHaveBeenCalled();
  });
});

describe('restart / retry', () => {
  it('restarts via a restartable source and re-enters signing', async () => {
    const source = makeRestartable();
    const { result } = render(signingOptions({ source }));
    postSigningMessage({ event: 'session_timeout' });
    await act(async () => {
      await result.current.restart();
    });
    expect(source.restart).toHaveBeenCalledWith(okSession);
    expect(result.current.status).toBe('signing');
    expect(result.current.error).toBeNull();
    expect(result.current.signingUrl).toBe('https://sign/2');
  });

  it('retry from a generic error returns to idle', () => {
    const { result } = render(signingOptions());
    postSigningMessage({ event: 'exception', message: 'x' });
    act(() => result.current.retry());
    expect(result.current.status).toBe('idle');
    expect(result.current.error).toBeNull();
  });

  it('restart on a non-restartable source falls back to retry', async () => {
    const { result } = render(signingOptions());
    postSigningMessage({ event: 'session_timeout' });
    await act(async () => {
      await result.current.restart();
    });
    expect(result.current.status).toBe('idle');
  });

  it('reports an error when restart rejects', async () => {
    const source = makeRestartable({
      restart: jest.fn().mockRejectedValue({ code: 'RESTART_FAILED' }),
    });
    const { result } = render(signingOptions({ source }));
    postSigningMessage({ event: 'session_timeout' });
    await act(async () => {
      await result.current.restart();
    });
    expect(result.current.status).toBe('error');
    expect(callbacks.onError).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'RESTART_FAILED' }),
    );
  });
});

describe('offline recovery', () => {
  const offlineOptions = () => ({
    ...callbacks,
    source: makeSource(),
    __testInitialStatus: 'offline' as const,
  });

  it('re-checking while online returns to idle', () => {
    const { result } = render(offlineOptions());
    onLineSpy.mockReturnValue(true);
    act(() => result.current.checkConnection());
    expect(result.current.status).toBe('idle');
  });

  it('re-checking while still offline stays offline', () => {
    onLineSpy.mockReturnValue(false);
    const { result } = render(offlineOptions());
    act(() => result.current.checkConnection());
    expect(result.current.status).toBe('offline');
  });
});

describe('cancel from idle', () => {
  it('calls onCancel', () => {
    const { result } = render({ ...callbacks, source: makeSource() });
    act(() => result.current.cancel());
    expect(callbacks.onCancel).toHaveBeenCalledTimes(1);
    expect(result.current.status).toBe('idle');
  });
});

describe('lifecycle', () => {
  it('clears the pending success timeout on unmount', () => {
    jest.useFakeTimers();
    const { unmount } = render(signingOptions());
    postSigningMessage({ event: 'signing_complete' });
    unmount();
    act(() => jest.advanceTimersByTime(1500));
    expect(callbacks.onComplete).not.toHaveBeenCalled();
    jest.useRealTimers();
  });

  it('unmounts cleanly when no success timeout is pending', () => {
    const { unmount } = render({ ...callbacks, source: makeSource() });
    expect(() => unmount()).not.toThrow();
  });
});

describe('DocuSign.js mount path (mountable source)', () => {
  const makeMountable = (
    mount: (
      c: HTMLElement,
      onEvent: (e: unknown) => void,
    ) => Promise<() => void>,
  ) => ({
    start: jest.fn().mockResolvedValue(okSession),
    interpret: () => null,
    mount,
  });

  // Attach a container the way a host's <div ref={embed.ref}> would
  const attach = (result: { current: { embed: unknown } }) => {
    const div = document.createElement('div');
    act(() => {
      const embed = result.current.embed as {
        kind: 'mount';
        ref: (el: HTMLDivElement | null) => void;
      };
      embed.ref(div);
    });
    return div;
  };

  it('exposes a mount embed and drives cancel via the mount callback', async () => {
    let captured: ((e: unknown) => void) | undefined;
    const cleanup = jest.fn();
    const mount = jest.fn(
      async (_c: HTMLElement, onEvent: (e: unknown) => void) => {
        captured = onEvent;
        return cleanup;
      },
    );
    const { result } = render(signingOptions({ source: makeMountable(mount) }));
    expect(result.current.embed?.kind).toBe('mount');
    expect(mount).not.toHaveBeenCalled(); // nothing to mount into yet

    const div = attach(result);
    await waitFor(() =>
      expect(mount).toHaveBeenCalledWith(div, expect.any(Function)),
    );

    act(() => captured!({ type: 'cancel' }));
    expect(result.current.status).toBe('idle');
    expect(result.current.embed).toBeNull();
    expect(callbacks.onCancel).toHaveBeenCalledTimes(1);
  });

  it('surfaces a mount failure as an error', async () => {
    const mount = jest.fn().mockRejectedValue({ code: 'PROVIDER_UNAVAILABLE' });
    const { result } = render(signingOptions({ source: makeMountable(mount) }));
    attach(result);
    await waitFor(() =>
      expect(callbacks.onError).toHaveBeenCalledWith(
        expect.objectContaining({ code: 'PROVIDER_UNAVAILABLE' }),
      ),
    );
    expect(result.current.status).toBe('error');
  });

  it('falls back to SIGNING_ERROR when a mount failure has no code', async () => {
    const mount = jest.fn().mockRejectedValue(new Error('sdk exploded'));
    const { result } = render(signingOptions({ source: makeMountable(mount) }));
    attach(result);
    await waitFor(() =>
      expect(callbacks.onError).toHaveBeenCalledWith(
        expect.objectContaining({ code: 'SIGNING_ERROR' }),
      ),
    );
  });

  it('cleans up the SDK mount on unmount', async () => {
    const cleanup = jest.fn();
    const mount = jest.fn().mockResolvedValue(cleanup);
    const { result, unmount } = render(
      signingOptions({ source: makeMountable(mount) }),
    );
    attach(result);
    await waitFor(() => expect(mount).toHaveBeenCalled());
    unmount();
    expect(cleanup).toHaveBeenCalled();
  });

  it('runs the cleanup immediately when unmounted before mount resolves', async () => {
    const cleanup = jest.fn();
    let resolveMount: ((c: () => void) => void) | undefined;
    const mount = jest.fn(
      () =>
        new Promise<() => void>(resolve => {
          resolveMount = resolve;
        }),
    );
    const { result, unmount } = render(
      signingOptions({ source: makeMountable(mount) }),
    );
    attach(result);
    await waitFor(() => expect(mount).toHaveBeenCalled());
    unmount();
    expect(cleanup).not.toHaveBeenCalled();

    await act(async () => resolveMount!(cleanup));
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it('mounts once the container is attached after signing already started', async () => {
    const cleanup = jest.fn();
    const mount = jest.fn().mockResolvedValue(cleanup);
    const source = makeMountable(mount);
    const { result } = render({ ...callbacks, source });
    await act(async () => {
      await result.current.sign();
    });
    expect(result.current.status).toBe('signing');
    expect(mount).not.toHaveBeenCalled();

    const div = attach(result);
    await waitFor(() =>
      expect(mount).toHaveBeenCalledWith(div, expect.any(Function)),
    );
  });

  it('does not listen for window messages while SDK-mounted', () => {
    const { result } = render(
      signingOptions({ source: makeMountable(jest.fn()) }),
    );
    postSigningMessage({ event: 'cancel' });
    expect(result.current.status).toBe('signing');
    expect(callbacks.onCancel).not.toHaveBeenCalled();
  });
});
