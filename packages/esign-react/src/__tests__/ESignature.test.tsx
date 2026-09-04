/**
 * ESignature (web) component tests - the default UI over useESignature.
 *
 * The state machine itself is covered in useESignature.test.tsx; here we
 * check that each status renders its screen, that the buttons are wired to
 * the hook's actions, and that theme / styles / labels reach the markup.
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
import { useESignature } from '../index';
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

const makeRestartable = () => ({
  start: jest.fn().mockResolvedValue(okSession),
  interpret: interpretProxyEvent,
  restart: jest.fn().mockResolvedValue({ ...okSession, url: 'https://sign/2' }),
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
  it('idle shows the default label, subtitle, and cancel', () => {
    render(<ESignature {...defaultProps} source={makeSource()} />);
    expect(screen.getByTestId('sign-document-button').textContent).toBe(
      'Sign Document',
    );
    expect(screen.getByText('Review and sign your document')).toBeTruthy();
    expect(screen.getByTestId('cancel-button').textContent).toBe('Cancel');
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
    const iframe = screen.getByTestId('signing-iframe');
    expect(iframe.getAttribute('src')).toBe('https://sign/x');
    expect(iframe.getAttribute('title')).toBe('Document signing');
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

  it('renders a mount container for a DocuSign.js source', async () => {
    const cleanup = jest.fn();
    const mount = jest.fn().mockResolvedValue(cleanup);
    const { unmount } = render(
      <ESignature
        {...defaultProps}
        source={
          { ...makeSource({ interpret: () => null }), mount } as SigningSource
        }
        __testInitialStatus="signing"
        __testSession={okSession}
      />,
    );
    const container = screen.getByTestId('signing-iframe');
    expect(container.tagName).toBe('DIV');
    await waitFor(() =>
      expect(mount).toHaveBeenCalledWith(container, expect.any(Function)),
    );
    unmount();
    expect(cleanup).toHaveBeenCalled();
  });

  it.each([
    ['loading', 'loading-indicator', 'Preparing document...'],
    ['success', 'success-screen', '✓ Signing Complete!'],
    ['offline', 'offline-text', 'Connection required to sign documents'],
    ['error', 'retry-button', 'An error occurred'],
  ] as const)('%s status renders %s', (initialStatus, testId, copy) => {
    const { unmount } = render(
      <ESignature
        {...defaultProps}
        source={makeSource()}
        __testInitialStatus={initialStatus}
      />,
    );
    expect(screen.getByTestId(testId)).toBeTruthy();
    expect(screen.getByText(copy)).toBeTruthy();
    unmount();
  });
});

describe('wiring to the hook', () => {
  it('sign button starts the source and shows the iframe', async () => {
    const source = makeSource();
    render(<ESignature {...defaultProps} source={source} />);
    await act(async () => {
      fireEvent.click(screen.getByTestId('sign-document-button'));
    });
    expect(source.start).toHaveBeenCalledTimes(1);
    expect(await screen.findByTestId('signing-iframe')).toBeTruthy();
  });

  it('sign button goes offline when navigator is offline', () => {
    onLineSpy.mockReturnValue(false);
    render(<ESignature {...defaultProps} source={makeSource()} />);
    fireEvent.click(screen.getByTestId('sign-document-button'));
    expect(screen.getByTestId('offline-text')).toBeTruthy();
  });

  it('cancel from idle calls onCancel', () => {
    render(<ESignature {...defaultProps} source={makeSource()} />);
    fireEvent.click(screen.getByTestId('cancel-button'));
    expect(defaultProps.onCancel).toHaveBeenCalledTimes(1);
  });

  it('signing-page messages reach the hook: complete → success screen', () => {
    jest.useFakeTimers();
    const { unmount } = render(
      <ESignature
        {...defaultProps}
        source={makeSource()}
        __testInitialStatus="signing"
        __testSession={okSession}
      />,
    );
    act(() => postSigningMessage({ event: 'signing_complete' }));
    expect(screen.getByTestId('success-screen')).toBeTruthy();
    unmount();
    jest.useRealTimers();
  });

  it('exception → error screen with the message; retry returns to idle', () => {
    render(
      <ESignature
        {...defaultProps}
        source={makeSource()}
        __testInitialStatus="signing"
        __testSession={okSession}
      />,
    );
    act(() => postSigningMessage({ event: 'exception', message: 'kaboom' }));
    expect(screen.getByTestId('error-message').textContent).toContain('kaboom');
    fireEvent.click(screen.getByTestId('retry-button'));
    expect(screen.getByTestId('sign-document-button')).toBeTruthy();
  });

  it('session_timeout → restart button, which restarts the source', async () => {
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
    expect(screen.getByTestId('restart-button').textContent).toBe('Restart');
    await act(async () => {
      fireEvent.click(screen.getByTestId('restart-button'));
    });
    expect(source.restart).toHaveBeenCalledWith(okSession);
    expect(await screen.findByTestId('signing-iframe')).toBeTruthy();
  });

  it('check-connection returns to idle when online', () => {
    render(
      <ESignature
        {...defaultProps}
        source={makeSource()}
        __testInitialStatus="offline"
      />,
    );
    fireEvent.click(screen.getByTestId('check-connection-button'));
    expect(screen.getByTestId('sign-document-button')).toBeTruthy();
  });
});

describe('theming', () => {
  it('defaults to the iOS blue primary button', () => {
    render(<ESignature {...defaultProps} source={makeSource()} />);
    expect(
      screen.getByTestId('sign-document-button').style.backgroundColor,
    ).toBe('rgb(0, 122, 255)');
  });

  it('theme.primaryColor recolors the sign button, the cancel text, and the spinner', () => {
    const theme = { primaryColor: '#F7931A', primaryTextColor: '#000' };
    const { unmount } = render(
      <ESignature {...defaultProps} source={makeSource()} theme={theme} />,
    );
    const sign = screen.getByTestId('sign-document-button');
    expect(sign.style.backgroundColor).toBe('rgb(247, 147, 26)');
    expect(sign.style.color).toBe('rgb(0, 0, 0)');
    expect(screen.getByTestId('cancel-button').style.color).toBe(
      'rgb(247, 147, 26)',
    );
    unmount();

    render(
      <ESignature
        {...defaultProps}
        source={makeSource()}
        theme={theme}
        __testInitialStatus="loading"
      />,
    );
    expect(screen.getByTestId('loading-indicator').style.borderTopColor).toBe(
      'rgb(247, 147, 26)',
    );
  });

  it('styles.button wins over the theme', () => {
    render(
      <ESignature
        {...defaultProps}
        source={makeSource()}
        theme={{ primaryColor: '#F7931A' }}
        styles={{ button: { backgroundColor: '#123456', borderRadius: 0 } }}
      />,
    );
    const sign = screen.getByTestId('sign-document-button');
    expect(sign.style.backgroundColor).toBe('rgb(18, 52, 86)');
    expect(sign.style.borderRadius).toBe('0');
  });

  it('labels override the built-in copy, with label as the sign fallback', () => {
    render(
      <ESignature
        {...defaultProps}
        source={makeSource()}
        label="Sign the agreement"
        labels={{ subtitle: 'Bitte unterschreiben', cancel: 'Abbrechen' }}
      />,
    );
    expect(screen.getByTestId('sign-document-button').textContent).toBe(
      'Sign the agreement',
    );
    expect(screen.getByText('Bitte unterschreiben')).toBeTruthy();
    expect(screen.getByTestId('cancel-button').textContent).toBe('Abbrechen');
    expect(screen.queryByText('Review and sign your document')).toBeNull();
  });
});

describe('hook-only usage', () => {
  // A host that ignores the default UI and renders its own button + iframe
  const CustomSigning = (options: UseESignatureOptions) => {
    const { status, sign, embed } = useESignature(options);
    if (embed?.kind === 'iframe') {
      return <iframe {...embed.iframeProps} data-testid="custom-iframe" />;
    }
    return (
      <div>
        <span data-testid="custom-status">{status}</span>
        <button type="button" data-testid="custom-sign" onClick={sign}>
          Go
        </button>
      </div>
    );
  };

  it('drives idle → signing → complete → onComplete with no ESignature', async () => {
    jest.useFakeTimers();
    const onComplete = jest.fn();
    render(
      <CustomSigning
        {...defaultProps}
        onComplete={onComplete}
        source={makeSource()}
        successDelayMs={10}
      />,
    );
    expect(screen.queryByTestId('sign-document-button')).toBeNull();
    expect(screen.getByTestId('custom-status').textContent).toBe('idle');

    await act(async () => {
      fireEvent.click(screen.getByTestId('custom-sign'));
    });
    expect(screen.getByTestId('custom-iframe').getAttribute('src')).toBe(
      'https://sign/1',
    );

    act(() => postSigningMessage({ event: 'signing_complete' }));
    expect(screen.getByTestId('custom-status').textContent).toBe('success');
    act(() => jest.advanceTimersByTime(10));
    expect(onComplete).toHaveBeenCalledWith({
      envelopeId: 'env-1',
      status: 'completed',
    });
    jest.useRealTimers();
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
