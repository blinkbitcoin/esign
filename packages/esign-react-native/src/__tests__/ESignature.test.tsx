/**
 * ESignature component tests - source-driven (provider-agnostic).
 *
 * The component is tested against fake SigningSources rather than Apollo mocks:
 * acquisition + event protocol live in the source, so the component's state
 * machine can be exercised directly. Per-source behavior is covered in
 * src/signing/__tests__.
 */

import React from 'react';
import ReactTestRenderer from 'react-test-renderer';

import { ESignature, getErrorMessage } from '../ESignature';
import { getApolloErrorCode } from '../index';
import { interpretProxyEvent } from '@blinkbitcoin/esignature-core';
import {
  simulateWebViewMessage,
  simulateRawWebViewMessage,
  resetWebViewMock,
} from '../../__mocks__/react-native-webview';
import NetInfo, {
  setMockNetworkState,
  resetMockNetworkState,
} from '../../__mocks__/@react-native-community/netinfo';

import type {
  SigningSource,
  SigningSession,
} from '@blinkbitcoin/esignature-core';

// react-native-webview is mocked via moduleNameMapper in jest.config.js

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

const defaultProps = {
  onComplete: jest.fn(),
  onError: jest.fn(),
  onCancel: jest.fn(),
};

const flush = () =>
  new Promise<void>(resolve => setTimeout(() => resolve(), 0));

const render = (
  element: React.ReactElement,
): ReactTestRenderer.ReactTestRenderer => {
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  ReactTestRenderer.act(() => {
    renderer = ReactTestRenderer.create(element);
  });
  return renderer;
};

const nodesByTestId = (
  renderer: ReactTestRenderer.ReactTestRenderer,
  id: string,
) => renderer.root.findAll(n => n.props?.testID === id);

// testIDs are forwarded to several nodes by the RN preset; "exists" = any match.
const has = (
  renderer: ReactTestRenderer.ReactTestRenderer,
  id: string,
): boolean => nodesByTestId(renderer, id).length > 0;

const press = (renderer: ReactTestRenderer.ReactTestRenderer, id: string) => {
  const node = nodesByTestId(renderer, id).find(
    n => typeof n.props.onPress === 'function',
  );
  node!.props.onPress();
};

beforeEach(() => {
  jest.clearAllMocks();
  resetWebViewMock();
  resetMockNetworkState();
});

describe('rendering by status', () => {
  it('idle shows the default label and buttons', () => {
    const r = render(<ESignature {...defaultProps} source={makeSource()} />);
    expect(JSON.stringify(r.toJSON())).toContain('Sign Document');
    expect(has(r, 'sign-document-button')).toBe(true);
    expect(has(r, 'cancel-button')).toBe(true);
  });

  it('idle honors a custom label', () => {
    const r = render(
      <ESignature
        {...defaultProps}
        source={makeSource()}
        label="Sign Onboarding"
      />,
    );
    expect(JSON.stringify(r.toJSON())).toContain('Sign Onboarding');
  });

  it('loading shows the spinner', () => {
    const r = render(
      <ESignature
        {...defaultProps}
        source={makeSource()}
        __testInitialStatus="loading"
      />,
    );
    expect(has(r, 'loading-indicator')).toBe(true);
  });

  it('signing renders the WebView when a URL is present', () => {
    const r = render(
      <ESignature
        {...defaultProps}
        source={makeSource()}
        __testInitialStatus="signing"
        __testSigningUrl="https://sign/x"
      />,
    );
    expect(has(r, 'signing-webview')).toBe(true);
  });

  it('signing without a URL shows the fallback copy', () => {
    const r = render(
      <ESignature
        {...defaultProps}
        source={makeSource()}
        __testInitialStatus="signing"
      />,
    );
    expect(JSON.stringify(r.toJSON())).toContain('Signing in Progress');
  });

  it('success shows the completion screen', () => {
    const r = render(
      <ESignature
        {...defaultProps}
        source={makeSource()}
        __testInitialStatus="success"
      />,
    );
    expect(has(r, 'success-screen')).toBe(true);
  });

  it('offline shows the connection screen', () => {
    const r = render(
      <ESignature
        {...defaultProps}
        source={makeSource()}
        __testInitialStatus="offline"
      />,
    );
    expect(has(r, 'offline-text')).toBe(true);
  });

  it('a plain error shows the retry button', () => {
    const r = render(
      <ESignature
        {...defaultProps}
        source={makeSource()}
        __testInitialStatus="error"
      />,
    );
    expect(has(r, 'retry-button')).toBe(true);
  });
});

describe('handleSign (acquisition)', () => {
  it('goes offline without calling the source when connectivity fails', async () => {
    setMockNetworkState(false);
    const source = makeSource();
    const onError = jest.fn();
    const r = render(
      <ESignature {...defaultProps} onError={onError} source={source} />,
    );

    await ReactTestRenderer.act(async () => {
      press(r, 'sign-document-button');
      await flush();
    });

    expect(has(r, 'offline-text')).toBe(true);
    expect(source.start).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled(); // offline is a state, not an error
  });

  it('starts the source and enters signing on success', async () => {
    const source = makeSource();
    const r = render(<ESignature {...defaultProps} source={source} />);

    await ReactTestRenderer.act(async () => {
      press(r, 'sign-document-button');
      await flush();
    });

    expect(source.start).toHaveBeenCalledTimes(1);
    expect(has(r, 'signing-webview')).toBe(true);
  });

  it('shows an error and calls onError when start rejects with a coded error', async () => {
    const source = makeSource({
      start: jest.fn().mockRejectedValue({ code: 'PROVIDER_UNAVAILABLE' }),
    });
    const onError = jest.fn();
    const r = render(
      <ESignature {...defaultProps} onError={onError} source={source} />,
    );

    await ReactTestRenderer.act(async () => {
      press(r, 'sign-document-button');
      await flush();
    });

    expect(has(r, 'error-message')).toBe(true);
    expect(onError).toHaveBeenCalledWith({
      code: 'PROVIDER_UNAVAILABLE',
      message:
        'Signing service temporarily unavailable. Please try again later.',
    });
  });

  it('falls back to UNKNOWN_ERROR when the rejection has no code', async () => {
    const source = makeSource({
      start: jest.fn().mockRejectedValue(new Error('x')),
    });
    const onError = jest.fn();
    const r = render(
      <ESignature {...defaultProps} onError={onError} source={source} />,
    );

    await ReactTestRenderer.act(async () => {
      press(r, 'sign-document-button');
      await flush();
    });

    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'UNKNOWN_ERROR' }),
    );
  });
});

describe('WebView events (via source.interpret)', () => {
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

  it('complete → success, then onComplete with the session envelopeId after the delay', () => {
    jest.useFakeTimers();
    const onComplete = jest.fn();
    const r = renderSigning({ onComplete });

    ReactTestRenderer.act(() =>
      simulateWebViewMessage({ event: 'signing_complete' }),
    );
    expect(has(r, 'success-screen')).toBe(true);

    ReactTestRenderer.act(() => jest.advanceTimersByTime(1500));
    expect(onComplete).toHaveBeenCalledWith({
      envelopeId: 'env-1',
      status: 'completed',
    });
    jest.useRealTimers();
  });

  it('complete prefers an envelopeId carried in the event', () => {
    jest.useFakeTimers();
    const onComplete = jest.fn();
    render(
      <ESignature
        {...defaultProps}
        onComplete={onComplete}
        source={makeSource({
          interpret: () => ({ type: 'complete', envelopeId: 'from-event' }),
        })}
        __testInitialStatus="signing"
        __testSession={okSession}
      />,
    );
    ReactTestRenderer.act(() => simulateWebViewMessage({ anything: true }));
    ReactTestRenderer.act(() => jest.advanceTimersByTime(1500));
    expect(onComplete).toHaveBeenCalledWith({
      envelopeId: 'from-event',
      status: 'completed',
    });
    jest.useRealTimers();
  });

  it('complete with no envelopeId anywhere reports undefined', () => {
    jest.useFakeTimers();
    const onComplete = jest.fn();
    render(
      <ESignature
        {...defaultProps}
        onComplete={onComplete}
        source={makeSource()}
        __testInitialStatus="signing"
        __testSigningUrl="https://sign/x"
      />,
    );
    ReactTestRenderer.act(() =>
      simulateWebViewMessage({ event: 'signing_complete' }),
    );
    ReactTestRenderer.act(() => jest.advanceTimersByTime(1500));
    expect(onComplete).toHaveBeenCalledWith({
      envelopeId: undefined,
      status: 'completed',
    });
    jest.useRealTimers();
  });

  it.each(['cancel', 'decline'])('%s → idle and onCancel', event => {
    const onCancel = jest.fn();
    const r = renderSigning({ onCancel });
    ReactTestRenderer.act(() => simulateWebViewMessage({ event }));
    expect(has(r, 'sign-document-button')).toBe(true);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('session_timeout → error with a restart affordance (session preserved)', () => {
    const onError = jest.fn();
    const r = renderSigning({ onError });
    ReactTestRenderer.act(() =>
      simulateWebViewMessage({ event: 'session_timeout' }),
    );
    expect(has(r, 'restart-button')).toBe(true);
    expect(onError).toHaveBeenCalledWith({
      code: 'SESSION_EXPIRED',
      message: 'Session expired, tap to restart',
    });
  });

  it('exception → error with the raw message', () => {
    const onError = jest.fn();
    const r = renderSigning({ onError });
    ReactTestRenderer.act(() =>
      simulateWebViewMessage({
        event: 'exception',
        message: 'signing blew up',
      }),
    );
    expect(JSON.stringify(r.toJSON())).toContain('signing blew up');
    expect(onError).toHaveBeenCalledWith({
      code: 'SIGNING_ERROR',
      message: 'signing blew up',
    });
  });

  it('error event with no message falls back to a generic message', () => {
    const onError = jest.fn();
    render(
      <ESignature
        {...defaultProps}
        onError={onError}
        source={makeSource({
          interpret: () => ({ type: 'error', code: 'WEIRD' }),
        })}
        __testInitialStatus="signing"
        __testSession={okSession}
      />,
    );
    ReactTestRenderer.act(() => simulateWebViewMessage({ x: 1 }));
    expect(onError).toHaveBeenCalledWith({
      code: 'WEIRD',
      message: 'An error occurred. Please try again.',
    });
  });

  it('error event with no code falls back to SIGNING_ERROR', () => {
    const onError = jest.fn();
    render(
      <ESignature
        {...defaultProps}
        onError={onError}
        source={makeSource({
          interpret: () => ({ type: 'error', message: 'boom' }),
        })}
        __testInitialStatus="signing"
        __testSession={okSession}
      />,
    );
    ReactTestRenderer.act(() => simulateWebViewMessage({ x: 1 }));
    expect(onError).toHaveBeenCalledWith({
      code: 'SIGNING_ERROR',
      message: 'boom',
    });
  });

  it('unrecognized events are ignored (interpret returns null)', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const onError = jest.fn();
    const r = renderSigning({ onError });
    ReactTestRenderer.act(() => simulateWebViewMessage({ event: 'noise' }));
    expect(has(r, 'signing-webview')).toBe(true);
    expect(onError).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('invalid JSON is ignored', () => {
    const err = jest.spyOn(console, 'error').mockImplementation(() => {});
    const onError = jest.fn();
    const r = renderSigning({ onError });
    ReactTestRenderer.act(() => simulateRawWebViewMessage('not json'));
    expect(has(r, 'signing-webview')).toBe(true);
    expect(onError).not.toHaveBeenCalled();
    err.mockRestore();
  });
});

describe('restart / retry', () => {
  it('restarts via a restartable source and re-enters signing', async () => {
    const source = makeRestartable();
    const r = render(
      <ESignature
        {...defaultProps}
        source={source}
        __testInitialStatus="signing"
        __testSession={okSession}
      />,
    );
    ReactTestRenderer.act(() =>
      simulateWebViewMessage({ event: 'session_timeout' }),
    );
    await ReactTestRenderer.act(async () => {
      press(r, 'restart-button');
      await flush();
    });
    expect(source.restart).toHaveBeenCalledWith(okSession);
    expect(has(r, 'signing-webview')).toBe(true);
  });

  it('retry from a generic error returns to idle', () => {
    const r = render(
      <ESignature
        {...defaultProps}
        source={makeSource()}
        __testInitialStatus="signing"
        __testSession={okSession}
      />,
    );
    ReactTestRenderer.act(() =>
      simulateWebViewMessage({ event: 'exception', message: 'x' }),
    );
    ReactTestRenderer.act(() => press(r, 'retry-button'));
    expect(has(r, 'sign-document-button')).toBe(true);
  });

  it('restart on a non-restartable source falls back to retry (idle)', () => {
    // Public/WebForms sources aren't restartable; a session_timeout still
    // shows the restart button, but pressing it resets to idle.
    const r = render(
      <ESignature
        {...defaultProps}
        source={makeSource()}
        __testInitialStatus="signing"
        __testSession={okSession}
      />,
    );
    ReactTestRenderer.act(() =>
      simulateWebViewMessage({ event: 'session_timeout' }),
    );
    ReactTestRenderer.act(() => press(r, 'restart-button'));
    expect(has(r, 'sign-document-button')).toBe(true);
  });

  it('shows an error when restart rejects', async () => {
    const source = makeRestartable({
      restart: jest.fn().mockRejectedValue({ code: 'RESTART_FAILED' }),
    });
    const onError = jest.fn();
    const r = render(
      <ESignature
        {...defaultProps}
        onError={onError}
        source={source}
        __testInitialStatus="signing"
        __testSession={okSession}
      />,
    );
    ReactTestRenderer.act(() =>
      simulateWebViewMessage({ event: 'session_timeout' }),
    );
    await ReactTestRenderer.act(async () => {
      press(r, 'restart-button');
      await flush();
    });
    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'RESTART_FAILED' }),
    );
  });
});

describe('offline recovery', () => {
  it('re-checking while online returns to idle', async () => {
    const r = render(
      <ESignature
        {...defaultProps}
        source={makeSource()}
        __testInitialStatus="offline"
      />,
    );
    setMockNetworkState(true);
    await ReactTestRenderer.act(async () => {
      press(r, 'check-connection-button');
      await flush();
    });
    expect(has(r, 'sign-document-button')).toBe(true);
  });

  it('re-checking while still offline stays offline', async () => {
    setMockNetworkState(false);
    const r = render(
      <ESignature
        {...defaultProps}
        source={makeSource()}
        __testInitialStatus="offline"
      />,
    );
    await ReactTestRenderer.act(async () => {
      press(r, 'check-connection-button');
      await flush();
    });
    expect(has(r, 'offline-text')).toBe(true);
  });

  it('shows a transient "Checking..." disabled state while verifying', async () => {
    let resolveFetch!: (v: unknown) => void;
    (NetInfo.fetch as jest.Mock).mockImplementationOnce(
      () =>
        new Promise(res => {
          resolveFetch = res;
        }),
    );
    const r = render(
      <ESignature
        {...defaultProps}
        source={makeSource()}
        __testInitialStatus="offline"
      />,
    );

    ReactTestRenderer.act(() => press(r, 'check-connection-button'));
    expect(JSON.stringify(r.toJSON())).toContain('Checking...');

    await ReactTestRenderer.act(async () => {
      resolveFetch({ isConnected: true, isInternetReachable: true });
      await flush();
    });
    expect(has(r, 'sign-document-button')).toBe(true);
  });
});

describe('cancel from idle', () => {
  it('calls onCancel', () => {
    const onCancel = jest.fn();
    const r = render(
      <ESignature
        {...defaultProps}
        onCancel={onCancel}
        source={makeSource()}
      />,
    );
    ReactTestRenderer.act(() => press(r, 'cancel-button'));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});

describe('lifecycle', () => {
  it('clears the pending success timeout on unmount', () => {
    jest.useFakeTimers();
    const onComplete = jest.fn();
    const r = render(
      <ESignature
        {...defaultProps}
        onComplete={onComplete}
        source={makeSource()}
        __testInitialStatus="signing"
        __testSession={okSession}
      />,
    );
    ReactTestRenderer.act(() =>
      simulateWebViewMessage({ event: 'signing_complete' }),
    );
    ReactTestRenderer.act(() => r.unmount());
    ReactTestRenderer.act(() => jest.advanceTimersByTime(1500));
    expect(onComplete).not.toHaveBeenCalled();
    jest.useRealTimers();
  });

  it('unmounts cleanly when no success timeout is pending', () => {
    const r = render(<ESignature {...defaultProps} source={makeSource()} />);
    expect(() => ReactTestRenderer.act(() => r.unmount())).not.toThrow();
  });
});

describe('re-exports', () => {
  it('re-exports getErrorMessage (component) and getApolloErrorCode (index)', () => {
    expect(getErrorMessage('SESSION_EXPIRED')).toBe(
      'Session expired, tap to restart',
    );
    expect(typeof getApolloErrorCode).toBe('function');
  });
});
