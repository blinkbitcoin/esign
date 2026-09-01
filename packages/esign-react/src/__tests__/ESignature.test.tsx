/**
 * ESignature (web) component tests - source-driven (provider-agnostic).
 *
 * Tested against fake SigningSources; signing-page events are dispatched as
 * window MessageEvents (the iframe protocol). Per-source behavior lives in
 * src/signing/__tests__.
 */

import React from 'react';
import {
  render,
  screen,
  fireEvent,
  act,
  waitFor,
} from '@testing-library/react';

import { ESignature, getErrorMessage, getApolloErrorCode } from '../ESignature';
import { interpretProxyEvent } from '@blinkbitcoin/esign-core';

import type { SigningSource, SigningSession } from '@blinkbitcoin/esign-core';

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

const defaultProps = {
  onComplete: jest.fn(),
  onError: jest.fn(),
  onCancel: jest.fn(),
};

const postSigningMessage = (data: unknown, origin = 'https://signing.test') => {
  fireEvent(window, new MessageEvent('message', { data, origin }));
};

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

describe('rendering by status', () => {
  it('idle shows the default label and cancel', () => {
    render(<ESignature {...defaultProps} source={makeSource()} />);
    expect(screen.getByTestId('sign-document-button').textContent).toBe(
      'Sign Document',
    );
    fireEvent.click(screen.getByTestId('cancel-button'));
    expect(defaultProps.onCancel).toHaveBeenCalled();
  });

  it('idle honors a custom label', () => {
    render(
      <ESignature
        {...defaultProps}
        source={makeSource()}
        label="Sign Onboarding"
      />,
    );
    expect(screen.getByTestId('sign-document-button').textContent).toBe(
      'Sign Onboarding',
    );
  });

  it('renders the iframe while signing', () => {
    render(
      <ESignature
        {...defaultProps}
        source={makeSource()}
        __testInitialStatus="signing"
        __testSigningUrl="https://sign/x"
      />,
    );
    expect(screen.getByTestId('signing-iframe').getAttribute('src')).toBe(
      'https://sign/x',
    );
  });

  it('signing without a URL shows the fallback', () => {
    render(
      <ESignature
        {...defaultProps}
        source={makeSource()}
        __testInitialStatus="signing"
      />,
    );
    expect(screen.getByText(/Signing in Progress/)).toBeTruthy();
  });

  it.each([
    ['loading', 'loading-indicator'],
    ['success', 'success-screen'],
    ['offline', 'offline-text'],
    ['error', 'retry-button'],
  ] as const)('%s status renders %s', (initialStatus, testId) => {
    const { unmount } = render(
      <ESignature
        {...defaultProps}
        source={makeSource()}
        __testInitialStatus={initialStatus}
      />,
    );
    expect(screen.getByTestId(testId)).toBeTruthy();
    unmount();
  });
});

describe('handleSign (acquisition)', () => {
  it('goes offline without calling the source', () => {
    onLineSpy.mockReturnValue(false);
    const source = makeSource();
    render(<ESignature {...defaultProps} source={source} />);
    fireEvent.click(screen.getByTestId('sign-document-button'));
    expect(screen.getByTestId('offline-text')).toBeTruthy();
    expect(source.start).not.toHaveBeenCalled();
    expect(defaultProps.onError).not.toHaveBeenCalled();
  });

  it('starts the source and shows the iframe', async () => {
    const source = makeSource();
    render(<ESignature {...defaultProps} source={source} />);
    await act(async () => {
      fireEvent.click(screen.getByTestId('sign-document-button'));
    });
    expect(source.start).toHaveBeenCalledTimes(1);
    expect(await screen.findByTestId('signing-iframe')).toBeTruthy();
  });

  it('shows an error and calls onError when start rejects', async () => {
    const onError = jest.fn();
    const source = makeSource({
      start: jest.fn().mockRejectedValue({ code: 'PROVIDER_UNAVAILABLE' }),
    });
    render(<ESignature {...defaultProps} onError={onError} source={source} />);
    await act(async () => {
      fireEvent.click(screen.getByTestId('sign-document-button'));
    });
    const msg = await screen.findByTestId('error-message');
    expect(msg.textContent).toContain(
      'Signing service temporarily unavailable',
    );
    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'PROVIDER_UNAVAILABLE' }),
    );
  });

  it('falls back to UNKNOWN_ERROR when the rejection has no code', async () => {
    const onError = jest.fn();
    const source = makeSource({
      start: jest.fn().mockRejectedValue(new Error('x')),
    });
    render(<ESignature {...defaultProps} onError={onError} source={source} />);
    await act(async () => {
      fireEvent.click(screen.getByTestId('sign-document-button'));
    });
    await waitFor(() =>
      expect(onError).toHaveBeenCalledWith(
        expect.objectContaining({ code: 'UNKNOWN_ERROR' }),
      ),
    );
  });
});

describe('signing-page events + origin pinning', () => {
  const renderSigning = (props = {}) =>
    render(
      <ESignature
        {...defaultProps}
        source={makeSource()}
        __testInitialStatus="signing"
        __testSession={okSession}
        {...props}
      />,
    );

  it('ignores messages from a non-allowed origin', () => {
    const onCancel = jest.fn();
    renderSigning({ onCancel });
    act(() => postSigningMessage({ event: 'cancel' }, 'https://evil.test'));
    expect(screen.getByTestId('signing-iframe')).toBeTruthy();
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('complete → success then onComplete with the session envelopeId', () => {
    jest.useFakeTimers();
    const onComplete = jest.fn();
    renderSigning({ onComplete });
    act(() => postSigningMessage({ event: 'signing_complete' }));
    expect(screen.getByTestId('success-screen')).toBeTruthy();
    act(() => jest.advanceTimersByTime(1500));
    expect(onComplete).toHaveBeenCalledWith({
      envelopeId: 'env-1',
      status: 'completed',
    });
    jest.useRealTimers();
  });

  it('accepts a JSON-string payload (the mock page posts text)', () => {
    jest.useFakeTimers();
    const onComplete = jest.fn();
    renderSigning({ onComplete });
    act(() =>
      postSigningMessage(JSON.stringify({ event: 'signing_complete' })),
    );
    act(() => jest.advanceTimersByTime(1500));
    expect(onComplete).toHaveBeenCalledWith({
      envelopeId: 'env-1',
      status: 'completed',
    });
    jest.useRealTimers();
  });

  it.each(['cancel', 'decline'])('%s → idle and onCancel', event => {
    const onCancel = jest.fn();
    renderSigning({ onCancel });
    act(() => postSigningMessage({ event }));
    expect(screen.getByTestId('sign-document-button')).toBeTruthy();
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('session_timeout → error with restart affordance', () => {
    const onError = jest.fn();
    renderSigning({ onError });
    act(() => postSigningMessage({ event: 'session_timeout' }));
    expect(screen.getByTestId('restart-button')).toBeTruthy();
    expect(onError).toHaveBeenCalledWith({
      code: 'SESSION_EXPIRED',
      message: 'Session expired, tap to restart',
    });
  });

  it('exception → error with the raw message', () => {
    const onError = jest.fn();
    renderSigning({ onError });
    act(() => postSigningMessage({ event: 'exception', message: 'kaboom' }));
    expect(screen.getByTestId('error-message').textContent).toContain('kaboom');
    expect(onError).toHaveBeenCalledWith({
      code: 'SIGNING_ERROR',
      message: 'kaboom',
    });
  });

  it('error event with no code/message uses fallbacks', () => {
    const onError = jest.fn();
    render(
      <ESignature
        {...defaultProps}
        onError={onError}
        source={makeSource({ interpret: () => ({ type: 'error' }) })}
        __testInitialStatus="signing"
        __testSession={okSession}
      />,
    );
    act(() => postSigningMessage({ x: 1 }));
    expect(onError).toHaveBeenCalledWith({
      code: 'SIGNING_ERROR',
      message: 'An error occurred. Please try again.',
    });
  });

  it('ignores unrelated messages (interpret returns null)', () => {
    const onError = jest.fn();
    renderSigning({ onError });
    act(() => postSigningMessage({ hello: 'world' }));
    act(() => postSigningMessage('not json'));
    expect(screen.getByTestId('signing-iframe')).toBeTruthy();
    expect(onError).not.toHaveBeenCalled();
  });

  it('removes the window listener when signing ends', () => {
    const onCancel = jest.fn();
    renderSigning({ onCancel });
    act(() => postSigningMessage({ event: 'cancel' })); // → idle, listener removed
    act(() => postSigningMessage({ event: 'signing_complete' })); // ignored now
    expect(screen.getByTestId('sign-document-button')).toBeTruthy();
  });
});

describe('restart / retry', () => {
  it('restarts via a restartable source', async () => {
    const source = makeRestartable();
    render(
      <ESignature
        {...defaultProps}
        source={source}
        __testInitialStatus="signing"
        __testSession={okSession}
      />,
    );
    act(() => postSigningMessage({ event: 'session_timeout' }));
    await act(async () => {
      fireEvent.click(screen.getByTestId('restart-button'));
    });
    expect(source.restart).toHaveBeenCalledWith(okSession);
    expect(await screen.findByTestId('signing-iframe')).toBeTruthy();
  });

  it('retry from a generic error returns to idle', () => {
    render(
      <ESignature
        {...defaultProps}
        source={makeSource()}
        __testInitialStatus="signing"
        __testSession={okSession}
      />,
    );
    act(() => postSigningMessage({ event: 'exception', message: 'x' }));
    fireEvent.click(screen.getByTestId('retry-button'));
    expect(screen.getByTestId('sign-document-button')).toBeTruthy();
  });

  it('restart on a non-restartable source falls back to retry', () => {
    render(
      <ESignature
        {...defaultProps}
        source={makeSource()}
        __testInitialStatus="signing"
        __testSession={okSession}
      />,
    );
    act(() => postSigningMessage({ event: 'session_timeout' }));
    fireEvent.click(screen.getByTestId('restart-button'));
    expect(screen.getByTestId('sign-document-button')).toBeTruthy();
  });

  it('shows an error when restart rejects', async () => {
    const onError = jest.fn();
    const source = makeRestartable({
      restart: jest.fn().mockRejectedValue({ code: 'RESTART_FAILED' }),
    });
    render(
      <ESignature
        {...defaultProps}
        onError={onError}
        source={source}
        __testInitialStatus="signing"
        __testSession={okSession}
      />,
    );
    act(() => postSigningMessage({ event: 'session_timeout' }));
    await act(async () => {
      fireEvent.click(screen.getByTestId('restart-button'));
    });
    await waitFor(() =>
      expect(onError).toHaveBeenCalledWith(
        expect.objectContaining({ code: 'RESTART_FAILED' }),
      ),
    );
  });
});

describe('offline recovery', () => {
  it('re-checking while online returns to idle', () => {
    render(
      <ESignature
        {...defaultProps}
        source={makeSource()}
        __testInitialStatus="offline"
      />,
    );
    onLineSpy.mockReturnValue(true);
    fireEvent.click(screen.getByTestId('check-connection-button'));
    expect(screen.getByTestId('sign-document-button')).toBeTruthy();
  });

  it('re-checking while still offline stays offline', () => {
    onLineSpy.mockReturnValue(false);
    render(
      <ESignature
        {...defaultProps}
        source={makeSource()}
        __testInitialStatus="offline"
      />,
    );
    fireEvent.click(screen.getByTestId('check-connection-button'));
    expect(screen.getByTestId('offline-text')).toBeTruthy();
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

  it('renders a mount container and drives cancel via the mount callback', async () => {
    let captured: ((e: unknown) => void) | undefined;
    const cleanup = jest.fn();
    const mount = jest.fn(
      async (_c: HTMLElement, onEvent: (e: unknown) => void) => {
        captured = onEvent;
        return cleanup;
      },
    );
    const onCancel = jest.fn();
    render(
      <ESignature
        {...defaultProps}
        onCancel={onCancel}
        source={makeMountable(mount)}
        __testInitialStatus="signing"
        __testSession={okSession}
      />,
    );

    // The SDK container renders under the same testid; window postMessage is NOT used
    expect(screen.getByTestId('signing-iframe')).toBeTruthy();
    await waitFor(() => expect(mount).toHaveBeenCalled());

    act(() => captured!({ type: 'cancel' }));
    expect(screen.getByTestId('sign-document-button')).toBeTruthy();
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('surfaces a mount failure as an error', async () => {
    const onError = jest.fn();
    const mount = jest.fn().mockRejectedValue({ code: 'PROVIDER_UNAVAILABLE' });
    render(
      <ESignature
        {...defaultProps}
        onError={onError}
        source={makeMountable(mount)}
        __testInitialStatus="signing"
        __testSession={okSession}
      />,
    );
    await waitFor(() =>
      expect(onError).toHaveBeenCalledWith(
        expect.objectContaining({ code: 'PROVIDER_UNAVAILABLE' }),
      ),
    );
  });

  it('falls back to SIGNING_ERROR when a mount failure has no code', async () => {
    const onError = jest.fn();
    const mount = jest.fn().mockRejectedValue(new Error('sdk exploded'));
    render(
      <ESignature
        {...defaultProps}
        onError={onError}
        source={makeMountable(mount)}
        __testInitialStatus="signing"
        __testSession={okSession}
      />,
    );
    await waitFor(() =>
      expect(onError).toHaveBeenCalledWith(
        expect.objectContaining({ code: 'SIGNING_ERROR' }),
      ),
    );
  });

  it('cleans up the SDK mount on unmount', async () => {
    const cleanup = jest.fn();
    const mount = jest.fn().mockResolvedValue(cleanup);
    const { unmount } = render(
      <ESignature
        {...defaultProps}
        source={makeMountable(mount)}
        __testInitialStatus="signing"
        __testSession={okSession}
      />,
    );
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
    const { unmount } = render(
      <ESignature
        {...defaultProps}
        source={makeMountable(mount)}
        __testInitialStatus="signing"
        __testSession={okSession}
      />,
    );
    await waitFor(() => expect(mount).toHaveBeenCalled());
    unmount();
    expect(cleanup).not.toHaveBeenCalled();

    // The SDK finishes mounting into a container that no longer exists; the
    // late cleanup must run right away so no iframe/listeners leak.
    await act(async () => resolveMount!(cleanup));
    expect(cleanup).toHaveBeenCalledTimes(1);
  });
});

describe('re-exports', () => {
  it('re-exports getErrorMessage and getApolloErrorCode', () => {
    expect(getErrorMessage('SESSION_EXPIRED')).toBe(
      'Session expired, tap to restart',
    );
    expect(typeof getApolloErrorCode).toBe('function');
  });
});
