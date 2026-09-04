import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { interpretProxyEvent } from '@blinkbitcoin/esign-core';

import { HookSigning } from '../HookSigning';

import type {
  ESignatureStatus,
  SigningSource,
} from '@blinkbitcoin/esign-react';

const session = { url: 'https://sign/1', envelopeId: 'env-1' };

const makeSource = (): SigningSource => ({
  start: vi.fn().mockResolvedValue(session),
  interpret: interpretProxyEvent,
});

const callbacks = {
  onComplete: vi.fn(),
  onError: vi.fn(),
  onCancel: vi.fn(),
};

const post = (data: unknown) =>
  act(() => {
    window.dispatchEvent(new MessageEvent('message', { data }));
  });

beforeEach(() => vi.clearAllMocks());

test('drives the flow with its own buttons: idle → iframe → success', async () => {
  vi.useFakeTimers();
  const source = makeSource();
  render(<HookSigning {...callbacks} source={source} successDelayMs={10} />);
  expect(screen.getByTestId('hook-sign-button')).toBeTruthy();
  expect(screen.queryByTestId('sign-document-button')).toBeNull();

  await act(async () => {
    fireEvent.click(screen.getByTestId('hook-sign-button'));
  });
  expect(source.start).toHaveBeenCalledTimes(1);
  expect(screen.getByTestId('hook-iframe').getAttribute('src')).toBe(
    'https://sign/1',
  );

  post({ event: 'signing_complete' });
  expect(screen.getByText('Signed ✓')).toBeTruthy();
  act(() => vi.advanceTimersByTime(10));
  expect(callbacks.onComplete).toHaveBeenCalledWith({
    envelopeId: 'env-1',
    status: 'completed',
  });
  vi.useRealTimers();
});

test('cancel button calls onCancel', () => {
  render(<HookSigning {...callbacks} source={makeSource()} />);
  fireEvent.click(screen.getByTestId('hook-cancel-button'));
  expect(callbacks.onCancel).toHaveBeenCalledTimes(1);
});

test.each<[ESignatureStatus, string]>([
  ['loading', 'Loading…'],
  ['offline', 'Reconnect'],
])('renders the %s state', (status, copy) => {
  render(
    <HookSigning
      {...callbacks}
      source={makeSource()}
      __testInitialStatus={status}
    />,
  );
  expect(screen.getByText(copy)).toBeTruthy();
});

test('renders a mount container for a DocuSign.js source', () => {
  const source = {
    ...makeSource(),
    mount: vi.fn().mockResolvedValue(() => {}),
  } as SigningSource;
  render(
    <HookSigning
      {...callbacks}
      source={source}
      __testInitialStatus="signing"
      __testSession={session}
    />,
  );
  expect(screen.getByTestId('hook-mount')).toBeTruthy();
});

test('retry from an error returns to idle', () => {
  render(
    <HookSigning
      {...callbacks}
      source={makeSource()}
      __testInitialStatus="signing"
      __testSession={session}
    />,
  );
  post({ event: 'exception', message: 'boom' });
  expect(screen.getByTestId('hook-error-message').textContent).toBe('boom');
  fireEvent.click(screen.getByTestId('hook-retry-button'));
  expect(screen.getByTestId('hook-sign-button')).toBeTruthy();
});

test('session expiry offers a restart', () => {
  render(
    <HookSigning
      {...callbacks}
      source={makeSource()}
      __testInitialStatus="signing"
      __testSession={session}
    />,
  );
  post({ event: 'session_timeout' });
  expect(screen.getByTestId('hook-retry-button').textContent).toBe('Restart');
});

test('reconnect from offline returns to idle', () => {
  render(
    <HookSigning
      {...callbacks}
      source={makeSource()}
      __testInitialStatus="offline"
    />,
  );
  fireEvent.click(screen.getByTestId('hook-check-connection-button'));
  expect(screen.getByTestId('hook-sign-button')).toBeTruthy();
});
