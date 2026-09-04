/**
 * ESignature component tests - the default UI over useESignature.
 *
 * The state machine itself is covered in useESignature.test.tsx; here we
 * check that each status renders its screen, that the buttons are wired to
 * the hook's actions, and that theme / styles / labels reach the markup.
 */

import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { WebView } from 'react-native-webview';

import { ESignature, getErrorMessage } from '../ESignature';
import { getApolloErrorCode, useESignature } from '../index';
import { interpretProxyEvent } from '@blinkbitcoin/esign-core';
import {
  simulateWebViewMessage,
  resetWebViewMock,
} from '../../__mocks__/react-native-webview';
import NetInfo, {
  setMockNetworkState,
  resetMockNetworkState,
} from '../../__mocks__/@react-native-community/netinfo';

import type { SigningSource, SigningSession } from '@blinkbitcoin/esign-core';
import type { UseESignatureOptions } from '../types';

const okSession: SigningSession = {
  url: 'https://sign/1',
  envelopeId: 'env-1',
};

const makeSource = (overrides: Partial<SigningSource> = {}): SigningSource => ({
  start: jest.fn().mockResolvedValue(okSession),
  interpret: interpretProxyEvent,
  ...overrides,
});

const makeRestartable = () => ({
  start: jest.fn().mockResolvedValue(okSession),
  interpret: interpretProxyEvent,
  restart: jest
    .fn()
    .mockResolvedValue({ url: 'https://sign/2', envelopeId: 'env-1' }),
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

const text = (renderer: ReactTestRenderer.ReactTestRenderer) =>
  JSON.stringify(renderer.toJSON());

// Flattened style of the first node with this testID that carries a style
const styleOf = (renderer: ReactTestRenderer.ReactTestRenderer, id: string) =>
  StyleSheet.flatten(
    nodesByTestId(renderer, id).find(n => n.props.style)!.props.style,
  );

beforeEach(() => {
  jest.clearAllMocks();
  resetWebViewMock();
  resetMockNetworkState();
});

describe('rendering by status', () => {
  it('idle shows the default label and buttons', () => {
    const r = render(<ESignature {...defaultProps} source={makeSource()} />);
    expect(text(r)).toContain('Sign Document');
    expect(text(r)).toContain('Review and sign your document');
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
    expect(text(r)).toContain('Sign Onboarding');
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
    expect(text(r)).toContain('Preparing document...');
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
    expect(r.root.findByType(WebView).props.source).toEqual({
      uri: 'https://sign/x',
    });
  });

  it('signing without a URL shows the fallback copy', () => {
    const r = render(
      <ESignature
        {...defaultProps}
        source={makeSource()}
        __testInitialStatus="signing"
      />,
    );
    expect(text(r)).toContain('Signing in Progress');
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
    expect(text(r)).toContain('Signing Complete!');
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
    expect(has(r, 'check-connection-button')).toBe(true);
  });

  it('a plain error shows the retry button and the fallback message', () => {
    const r = render(
      <ESignature
        {...defaultProps}
        source={makeSource()}
        __testInitialStatus="error"
      />,
    );
    expect(has(r, 'retry-button')).toBe(true);
    expect(text(r)).toContain('An error occurred');
  });
});

describe('wiring to the hook', () => {
  it('sign button starts the source and renders the WebView', async () => {
    const source = makeSource();
    const r = render(<ESignature {...defaultProps} source={source} />);
    await ReactTestRenderer.act(async () => {
      press(r, 'sign-document-button');
      await flush();
    });
    expect(source.start).toHaveBeenCalledTimes(1);
    expect(has(r, 'signing-webview')).toBe(true);
  });

  it('sign button goes offline when connectivity fails', async () => {
    setMockNetworkState(false);
    const r = render(<ESignature {...defaultProps} source={makeSource()} />);
    await ReactTestRenderer.act(async () => {
      press(r, 'sign-document-button');
      await flush();
    });
    expect(has(r, 'offline-text')).toBe(true);
  });

  it('cancel from idle calls onCancel', () => {
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

  it('WebView messages reach the hook: complete → success screen', () => {
    jest.useFakeTimers();
    const r = render(
      <ESignature
        {...defaultProps}
        source={makeSource()}
        __testInitialStatus="signing"
        __testSession={okSession}
      />,
    );
    ReactTestRenderer.act(() =>
      simulateWebViewMessage({ event: 'signing_complete' }),
    );
    expect(has(r, 'success-screen')).toBe(true);
    ReactTestRenderer.act(() => r.unmount());
    jest.useRealTimers();
  });

  it('exception → error screen with the message; retry returns to idle', () => {
    const r = render(
      <ESignature
        {...defaultProps}
        source={makeSource()}
        __testInitialStatus="signing"
        __testSession={okSession}
      />,
    );
    ReactTestRenderer.act(() =>
      simulateWebViewMessage({
        event: 'exception',
        message: 'signing blew up',
      }),
    );
    expect(text(r)).toContain('signing blew up');
    expect(has(r, 'retry-button')).toBe(true);
    ReactTestRenderer.act(() => press(r, 'retry-button'));
    expect(has(r, 'sign-document-button')).toBe(true);
  });

  it('session_timeout → restart button, which restarts the source', async () => {
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
    expect(has(r, 'restart-button')).toBe(true);
    expect(text(r)).toContain('Restart');
    await ReactTestRenderer.act(async () => {
      press(r, 'restart-button');
      await flush();
    });
    expect(source.restart).toHaveBeenCalledWith(okSession);
    expect(has(r, 'signing-webview')).toBe(true);
  });

  it('check-connection returns to idle when online', async () => {
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
    expect(has(r, 'sign-document-button')).toBe(true);
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
    expect(text(r)).toContain('Checking...');
    expect(styleOf(r, 'check-connection-button').opacity).toBe(0.6);

    await ReactTestRenderer.act(async () => {
      resolveFetch({ isConnected: true, isInternetReachable: true });
      await flush();
    });
    expect(has(r, 'sign-document-button')).toBe(true);
  });
});

describe('theming', () => {
  it('defaults to the iOS blue primary button', () => {
    const r = render(<ESignature {...defaultProps} source={makeSource()} />);
    expect(styleOf(r, 'sign-document-button').backgroundColor).toBe('#007AFF');
  });

  it('theme.primaryColor recolors the sign button, the cancel text, and the spinner', () => {
    const theme = { primaryColor: '#F7931A', primaryTextColor: '#000' };
    const r = render(
      <ESignature {...defaultProps} source={makeSource()} theme={theme} />,
    );
    expect(styleOf(r, 'sign-document-button').backgroundColor).toBe('#F7931A');
    const cancelText = nodesByTestId(r, 'cancel-button')[0].findByType(Text);
    expect(StyleSheet.flatten(cancelText.props.style).color).toBe('#F7931A');
    const signText = nodesByTestId(r, 'sign-document-button')[0].findByType(
      Text,
    );
    expect(StyleSheet.flatten(signText.props.style).color).toBe('#000');

    const loading = render(
      <ESignature
        {...defaultProps}
        source={makeSource()}
        theme={theme}
        __testInitialStatus="loading"
      />,
    );
    expect(nodesByTestId(loading, 'loading-indicator')[0].props.color).toBe(
      '#F7931A',
    );
  });

  it('styles.button wins over the theme', () => {
    const r = render(
      <ESignature
        {...defaultProps}
        source={makeSource()}
        theme={{ primaryColor: '#F7931A' }}
        styles={{ button: { backgroundColor: '#123456', borderRadius: 0 } }}
      />,
    );
    const style = styleOf(r, 'sign-document-button');
    expect(style.backgroundColor).toBe('#123456');
    expect(style.borderRadius).toBe(0);
  });

  it('labels override the built-in copy, with label as the sign fallback', () => {
    const r = render(
      <ESignature
        {...defaultProps}
        source={makeSource()}
        label="Sign the agreement"
        labels={{ subtitle: 'Bitte unterschreiben', cancel: 'Abbrechen' }}
      />,
    );
    expect(text(r)).toContain('Sign the agreement');
    expect(text(r)).toContain('Bitte unterschreiben');
    expect(text(r)).toContain('Abbrechen');
    expect(text(r)).not.toContain('Review and sign your document');
  });
});

describe('hook-only usage', () => {
  // A host that ignores the default UI and renders its own buttons + WebView
  const CustomSigning = (options: UseESignatureOptions) => {
    const { status, sign, webViewProps } = useESignature(options);
    if (webViewProps) {
      return <WebView {...webViewProps} testID="custom-webview" />;
    }
    return (
      <View>
        <Text testID="custom-status">{status}</Text>
        <TouchableOpacity testID="custom-sign" onPress={sign}>
          <Text>Go</Text>
        </TouchableOpacity>
      </View>
    );
  };

  it('drives idle → signing → complete → onComplete with no ESignature', async () => {
    jest.useFakeTimers();
    const onComplete = jest.fn();
    const r = render(
      <CustomSigning
        {...defaultProps}
        onComplete={onComplete}
        source={makeSource()}
        successDelayMs={10}
      />,
    );
    expect(has(r, 'sign-document-button')).toBe(false);
    expect(text(r)).toContain('idle');

    await ReactTestRenderer.act(async () => {
      press(r, 'custom-sign');
      await Promise.resolve();
    });
    expect(has(r, 'custom-webview')).toBe(true);

    ReactTestRenderer.act(() =>
      simulateWebViewMessage({ event: 'signing_complete' }),
    );
    expect(text(r)).toContain('success');
    ReactTestRenderer.act(() => jest.advanceTimersByTime(10));
    expect(onComplete).toHaveBeenCalledWith({
      envelopeId: 'env-1',
      status: 'completed',
    });
    jest.useRealTimers();
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
