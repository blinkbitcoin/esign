/**
 * useESignature hook tests - the headless state machine, source-driven.
 *
 * Exercised through a probe component (react-test-renderer; no RNTL here) and
 * fake SigningSources. WebView messages are delivered straight to the
 * onMessage handler the hook hands back in webViewProps. The default UI's
 * wiring is covered in ESignature.test.tsx.
 */

import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import type { WebViewMessageEvent } from 'react-native-webview';

import { useESignature } from '../useESignature';
import { interpretProxyEvent } from '@blinkbitcoin/esign-core';
import NetInfo, {
  setMockNetworkState,
  resetMockNetworkState,
} from '../../__mocks__/@react-native-community/netinfo';

import type { SigningSource, SigningSession } from '@blinkbitcoin/esign-core';
import type { UseESignatureOptions, UseESignatureResult } from '../types';

const okSession: SigningSession = {
  url: 'https://sign/1',
  envelopeId: 'env-1',
};

const makeSource = (overrides: Partial<SigningSource> = {}): SigningSource => ({
  start: jest.fn().mockResolvedValue(okSession),
  interpret: interpretProxyEvent,
  ...overrides,
});

const makeRestartable = (overrides = {}) => ({
  start: jest.fn().mockResolvedValue(okSession),
  interpret: interpretProxyEvent,
  restart: jest
    .fn()
    .mockResolvedValue({ url: 'https://sign/2', envelopeId: 'env-1' }),
  ...overrides,
});

const callbacks = {
  onComplete: jest.fn(),
  onError: jest.fn(),
  onCancel: jest.fn(),
};

const flush = () =>
  new Promise<void>(resolve => setTimeout(() => resolve(), 0));

const { act } = ReactTestRenderer;

// Minimal hook harness: renders nothing, exposes the latest hook result.
const renderHook = (options: UseESignatureOptions, strict = false) => {
  const result = { current: null as unknown as UseESignatureResult };
  const Probe = ({ opts }: { opts: UseESignatureOptions }) => {
    result.current = useESignature(opts);
    return null;
  };
  const element = (opts: UseESignatureOptions) =>
    strict ? (
      <React.StrictMode>
        <Probe opts={opts} />
      </React.StrictMode>
    ) : (
      <Probe opts={opts} />
    );
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  act(() => {
    renderer = ReactTestRenderer.create(element(options));
  });
  return {
    result,
    unmount: () => act(() => renderer.unmount()),
  };
};

const signingOptions = (overrides: Partial<UseESignatureOptions> = {}) => ({
  ...callbacks,
  source: makeSource(),
  __testInitialStatus: 'signing' as const,
  __testSession: okSession,
  ...overrides,
});

const deliver = (result: { current: UseESignatureResult }, data: unknown) =>
  act(() =>
    result.current.webViewProps!.onMessage!({
      nativeEvent: {
        data: typeof data === 'string' ? data : JSON.stringify(data),
      },
    } as unknown as WebViewMessageEvent),
  );

beforeEach(() => {
  jest.clearAllMocks();
  resetMockNetworkState();
});

describe('initial state', () => {
  it('starts idle with no error and no WebView props', () => {
    const { result } = renderHook({ ...callbacks, source: makeSource() });
    expect(result.current.status).toBe('idle');
    expect(result.current.error).toBeNull();
    expect(result.current.signingUrl).toBeNull();
    expect(result.current.isSessionExpired).toBe(false);
    expect(result.current.isCheckingConnection).toBe(false);
    expect(result.current.webViewProps).toBeNull();
  });

  it('seeds signing state from __testSigningUrl and exposes WebView props', () => {
    const { result } = renderHook({
      ...callbacks,
      source: makeSource(),
      __testInitialStatus: 'signing',
      __testSigningUrl: 'https://sign/x',
    });
    expect(result.current.signingUrl).toBe('https://sign/x');
    expect(result.current.webViewProps).toEqual(
      expect.objectContaining({
        source: { uri: 'https://sign/x' },
        javaScriptEnabled: true,
        domStorageEnabled: true,
        startInLoadingState: true,
      }),
    );
  });

  it('signing without a URL has no WebView props', () => {
    const { result } = renderHook({
      ...callbacks,
      source: makeSource(),
      __testInitialStatus: 'signing',
    });
    expect(result.current.status).toBe('signing');
    expect(result.current.webViewProps).toBeNull();
  });
});

describe('sign (acquisition)', () => {
  it('goes offline without calling the source when connectivity fails', async () => {
    setMockNetworkState(false);
    const source = makeSource();
    const { result } = renderHook({ ...callbacks, source });
    await act(async () => {
      await result.current.sign();
    });
    expect(result.current.status).toBe('offline');
    expect(source.start).not.toHaveBeenCalled();
    expect(callbacks.onError).not.toHaveBeenCalled(); // offline is a state, not an error
  });

  it('ignores a start() that resolves after unmount (no state update, no callbacks)', async () => {
    let resolveStart!: (session: SigningSession) => void;
    const source = makeSource({
      start: jest.fn().mockReturnValue(
        new Promise<SigningSession>(resolve => {
          resolveStart = resolve;
        }),
      ),
    });
    const { result, unmount } = renderHook({ ...callbacks, source });
    await act(async () => {
      result.current.sign();
      await flush();
    });
    unmount();
    await act(async () => {
      resolveStart(okSession);
      await flush();
    });
    expect(callbacks.onError).not.toHaveBeenCalled();
    expect(callbacks.onComplete).not.toHaveBeenCalled();
  });

  it('ignores a start() that rejects after unmount (onError not fired)', async () => {
    let rejectStart!: (e: unknown) => void;
    const source = makeSource({
      start: jest.fn().mockReturnValue(
        new Promise<SigningSession>((_resolve, reject) => {
          rejectStart = reject;
        }),
      ),
    });
    const { result, unmount } = renderHook({ ...callbacks, source });
    await act(async () => {
      result.current.sign();
      await flush();
    });
    unmount();
    await act(async () => {
      rejectStart({ code: 'PROVIDER_UNAVAILABLE' });
      await flush();
    });
    expect(callbacks.onError).not.toHaveBeenCalled();
  });

  it('enters signing under React.StrictMode (guard re-arms after double-mount)', async () => {
    const { result } = renderHook({ ...callbacks, source: makeSource() }, true);
    await act(async () => {
      await result.current.sign();
    });
    expect(result.current.status).toBe('signing');
  });

  it('starts the source and enters signing with the session URL', async () => {
    const source = makeSource();
    const { result } = renderHook({ ...callbacks, source });
    await act(async () => {
      await result.current.sign();
    });
    expect(source.start).toHaveBeenCalledTimes(1);
    expect(result.current.status).toBe('signing');
    expect(result.current.signingUrl).toBe('https://sign/1');
    expect(result.current.webViewProps?.source).toEqual({
      uri: 'https://sign/1',
    });
  });

  it('passes through loading while the source starts', async () => {
    let resolveStart!: (session: SigningSession) => void;
    const source = makeSource({
      start: jest.fn().mockReturnValue(
        new Promise<SigningSession>(resolve => {
          resolveStart = resolve;
        }),
      ),
    });
    const { result } = renderHook({ ...callbacks, source });
    await act(async () => {
      result.current.sign();
      await flush();
    });
    expect(result.current.status).toBe('loading');
    await act(async () => {
      resolveStart(okSession);
      await flush();
    });
    expect(result.current.status).toBe('signing');
  });

  it('enters error and calls onError when start rejects with a coded error', async () => {
    const source = makeSource({
      start: jest.fn().mockRejectedValue({ code: 'PROVIDER_UNAVAILABLE' }),
    });
    const { result } = renderHook({ ...callbacks, source });
    await act(async () => {
      await result.current.sign();
    });
    const expected = {
      code: 'PROVIDER_UNAVAILABLE',
      message:
        'Signing service temporarily unavailable. Please try again later.',
    };
    expect(result.current.status).toBe('error');
    expect(result.current.error).toEqual(expected);
    expect(result.current.isSessionExpired).toBe(false);
    expect(callbacks.onError).toHaveBeenCalledWith(expected);
  });

  it('falls back to UNKNOWN_ERROR when the rejection has no code', async () => {
    const source = makeSource({
      start: jest.fn().mockRejectedValue(new Error('x')),
    });
    const { result } = renderHook({ ...callbacks, source });
    await act(async () => {
      await result.current.sign();
    });
    expect(callbacks.onError).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'UNKNOWN_ERROR' }),
    );
  });
});

describe('WebView events (via source.interpret)', () => {
  it('complete → success, then onComplete with the session envelopeId after the delay', () => {
    jest.useFakeTimers();
    const { result } = renderHook(signingOptions());
    deliver(result, { event: 'signing_complete' });
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
    const { result } = renderHook(signingOptions({ successDelayMs: 100 }));
    deliver(result, { event: 'signing_complete' });
    act(() => jest.advanceTimersByTime(99));
    expect(callbacks.onComplete).not.toHaveBeenCalled();
    act(() => jest.advanceTimersByTime(1));
    expect(callbacks.onComplete).toHaveBeenCalledTimes(1);
    jest.useRealTimers();
  });

  it('complete prefers an envelopeId carried in the event', () => {
    jest.useFakeTimers();
    const { result } = renderHook(
      signingOptions({
        source: makeSource({
          interpret: () => ({ type: 'complete', envelopeId: 'from-event' }),
        }),
      }),
    );
    deliver(result, { anything: true });
    act(() => jest.advanceTimersByTime(1500));
    expect(callbacks.onComplete).toHaveBeenCalledWith({
      envelopeId: 'from-event',
      status: 'completed',
    });
    jest.useRealTimers();
  });

  it('complete with no envelopeId anywhere reports undefined', () => {
    jest.useFakeTimers();
    const { result } = renderHook({
      ...callbacks,
      source: makeSource(),
      __testInitialStatus: 'signing',
      __testSigningUrl: 'https://sign/x',
    });
    deliver(result, { event: 'signing_complete' });
    act(() => jest.advanceTimersByTime(1500));
    expect(callbacks.onComplete).toHaveBeenCalledWith({
      envelopeId: undefined,
      status: 'completed',
    });
    jest.useRealTimers();
  });

  it.each(['cancel', 'decline'])('%s → idle and onCancel', event => {
    const { result } = renderHook(signingOptions());
    deliver(result, { event });
    expect(result.current.status).toBe('idle');
    expect(result.current.webViewProps).toBeNull();
    expect(callbacks.onCancel).toHaveBeenCalledTimes(1);
  });

  it('session_timeout → error flagged as session expired (session preserved)', () => {
    const { result } = renderHook(signingOptions());
    deliver(result, { event: 'session_timeout' });
    expect(result.current.status).toBe('error');
    expect(result.current.isSessionExpired).toBe(true);
    expect(callbacks.onError).toHaveBeenCalledWith({
      code: 'SESSION_EXPIRED',
      message: 'Session expired, tap to restart',
    });
  });

  it('exception → error with the raw message', () => {
    const { result } = renderHook(signingOptions());
    deliver(result, { event: 'exception', message: 'signing blew up' });
    expect(result.current.error).toEqual({
      code: 'SIGNING_ERROR',
      message: 'signing blew up',
    });
    expect(result.current.isSessionExpired).toBe(false);
    expect(callbacks.onError).toHaveBeenCalledWith({
      code: 'SIGNING_ERROR',
      message: 'signing blew up',
    });
  });

  it('error event with no message falls back to a generic message', () => {
    const { result } = renderHook(
      signingOptions({
        source: makeSource({
          interpret: () => ({ type: 'error', code: 'WEIRD' }),
        }),
      }),
    );
    deliver(result, { x: 1 });
    expect(callbacks.onError).toHaveBeenCalledWith({
      code: 'WEIRD',
      message: 'An error occurred. Please try again.',
    });
  });

  it('error event with no code falls back to SIGNING_ERROR', () => {
    const { result } = renderHook(
      signingOptions({
        source: makeSource({
          interpret: () => ({ type: 'error', message: 'boom' }),
        }),
      }),
    );
    deliver(result, { x: 1 });
    expect(callbacks.onError).toHaveBeenCalledWith({
      code: 'SIGNING_ERROR',
      message: 'boom',
    });
  });

  it('unrecognized events are ignored (interpret returns null)', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const { result } = renderHook(signingOptions());
    deliver(result, { event: 'noise' });
    expect(result.current.status).toBe('signing');
    expect(callbacks.onError).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('invalid JSON is ignored', () => {
    const err = jest.spyOn(console, 'error').mockImplementation(() => {});
    const { result } = renderHook(signingOptions());
    deliver(result, 'not json');
    expect(result.current.status).toBe('signing');
    expect(callbacks.onError).not.toHaveBeenCalled();
    err.mockRestore();
  });
});

describe('restart / retry', () => {
  it('restarts via a restartable source and re-enters signing', async () => {
    const source = makeRestartable();
    const { result } = renderHook(signingOptions({ source }));
    deliver(result, { event: 'session_timeout' });
    await act(async () => {
      await result.current.restart();
    });
    expect(source.restart).toHaveBeenCalledWith(okSession);
    expect(result.current.status).toBe('signing');
    expect(result.current.error).toBeNull();
    expect(result.current.signingUrl).toBe('https://sign/2');
  });

  it('retry from a generic error returns to idle', () => {
    const { result } = renderHook(signingOptions());
    deliver(result, { event: 'exception', message: 'x' });
    act(() => result.current.retry());
    expect(result.current.status).toBe('idle');
    expect(result.current.error).toBeNull();
  });

  it('restart on a non-restartable source falls back to retry (idle)', async () => {
    const { result } = renderHook(signingOptions());
    deliver(result, { event: 'session_timeout' });
    await act(async () => {
      await result.current.restart();
    });
    expect(result.current.status).toBe('idle');
  });

  it('reports an error when restart rejects', async () => {
    const source = makeRestartable({
      restart: jest.fn().mockRejectedValue({ code: 'RESTART_FAILED' }),
    });
    const { result } = renderHook(signingOptions({ source }));
    deliver(result, { event: 'session_timeout' });
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

  it('re-checking while online returns to idle', async () => {
    const { result } = renderHook(offlineOptions());
    setMockNetworkState(true);
    await act(async () => {
      await result.current.checkConnection();
    });
    expect(result.current.status).toBe('idle');
  });

  it('re-checking while still offline stays offline', async () => {
    setMockNetworkState(false);
    const { result } = renderHook(offlineOptions());
    await act(async () => {
      await result.current.checkConnection();
    });
    expect(result.current.status).toBe('offline');
  });

  it('exposes isCheckingConnection while the re-check is in flight', async () => {
    let resolveFetch!: (v: unknown) => void;
    (NetInfo.fetch as jest.Mock).mockImplementationOnce(
      () =>
        new Promise(res => {
          resolveFetch = res;
        }),
    );
    const { result } = renderHook(offlineOptions());
    act(() => {
      result.current.checkConnection();
    });
    expect(result.current.isCheckingConnection).toBe(true);
    await act(async () => {
      resolveFetch({ isConnected: true, isInternetReachable: true });
      await flush();
    });
    expect(result.current.isCheckingConnection).toBe(false);
    expect(result.current.status).toBe('idle');
  });
});

describe('cancel from idle', () => {
  it('calls onCancel', () => {
    const { result } = renderHook({ ...callbacks, source: makeSource() });
    act(() => result.current.cancel());
    expect(callbacks.onCancel).toHaveBeenCalledTimes(1);
    expect(result.current.status).toBe('idle');
  });
});

describe('lifecycle', () => {
  it('clears the pending success timeout on unmount', () => {
    jest.useFakeTimers();
    const { result, unmount } = renderHook(signingOptions());
    deliver(result, { event: 'signing_complete' });
    unmount();
    act(() => jest.advanceTimersByTime(1500));
    expect(callbacks.onComplete).not.toHaveBeenCalled();
    jest.useRealTimers();
  });

  it('unmounts cleanly when no success timeout is pending', () => {
    const { unmount } = renderHook({ ...callbacks, source: makeSource() });
    expect(() => unmount()).not.toThrow();
  });
});
