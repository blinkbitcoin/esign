/**
 * @format
 */

import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import { interpretProxyEvent } from '@blinkbitcoin/esign-core';
import { simulateWebViewMessage } from '../../../packages/esign-react-native/__mocks__/react-native-webview';

import { HookSigning } from '../src/HookSigning';

import type {
  ESignatureStatus,
  SigningSource,
} from '@blinkbitcoin/esign-react-native';

const session = { url: 'https://sign/1', envelopeId: 'env-1' };

const makeSource = (): SigningSource => ({
  start: jest.fn().mockResolvedValue(session),
  interpret: interpretProxyEvent,
});

const callbacks = {
  onComplete: jest.fn(),
  onError: jest.fn(),
  onCancel: jest.fn(),
};

const render = (element: React.ReactElement) => {
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  ReactTestRenderer.act(() => {
    renderer = ReactTestRenderer.create(element);
  });
  return renderer;
};

const has = (r: ReactTestRenderer.ReactTestRenderer, testID: string) =>
  r.root.findAllByProps({ testID }).length > 0;

const press = (r: ReactTestRenderer.ReactTestRenderer, testID: string) =>
  r.root
    .findAllByProps({ testID })
    .find(n => n.props.onPress)!
    .props.onPress();

const flush = () =>
  new Promise<void>(resolve => setTimeout(() => resolve(), 0));

beforeEach(() => jest.clearAllMocks());

test('drives the flow with its own buttons: idle → WebView → success', async () => {
  jest.useFakeTimers();
  const source = makeSource();
  const r = render(
    <HookSigning {...callbacks} source={source} successDelayMs={10} />,
  );
  expect(has(r, 'hook-sign-button')).toBe(true);
  expect(has(r, 'sign-document-button')).toBe(false);

  await ReactTestRenderer.act(async () => {
    press(r, 'hook-sign-button');
    await Promise.resolve();
  });
  expect(source.start).toHaveBeenCalledTimes(1);
  expect(has(r, 'hook-webview')).toBe(true);

  ReactTestRenderer.act(() =>
    simulateWebViewMessage({ event: 'signing_complete' }),
  );
  expect(JSON.stringify(r.toJSON())).toContain('Signed');
  ReactTestRenderer.act(() => jest.advanceTimersByTime(10));
  expect(callbacks.onComplete).toHaveBeenCalledWith({
    envelopeId: 'env-1',
    status: 'completed',
  });
  jest.useRealTimers();
});

test('cancel button calls onCancel', () => {
  const r = render(<HookSigning {...callbacks} source={makeSource()} />);
  ReactTestRenderer.act(() => press(r, 'hook-cancel-button'));
  expect(callbacks.onCancel).toHaveBeenCalledTimes(1);
});

test.each<[ESignatureStatus, string]>([
  ['loading', 'loading'],
  ['error', 'hook-retry-button'],
  ['offline', 'hook-check-connection-button'],
])('renders the %s state', (status, marker) => {
  const r = render(
    <HookSigning
      {...callbacks}
      source={makeSource()}
      __testInitialStatus={status}
    />,
  );
  expect(JSON.stringify(r.toJSON())).toContain(marker);
});

test('retry from an error returns to idle', async () => {
  const r = render(
    <HookSigning
      {...callbacks}
      source={makeSource()}
      __testInitialStatus="signing"
      __testSession={session}
    />,
  );
  ReactTestRenderer.act(() =>
    simulateWebViewMessage({ event: 'exception', message: 'boom' }),
  );
  expect(JSON.stringify(r.toJSON())).toContain('boom');
  ReactTestRenderer.act(() => press(r, 'hook-retry-button'));
  expect(has(r, 'hook-sign-button')).toBe(true);
});

test('session expiry offers a restart', () => {
  const r = render(
    <HookSigning
      {...callbacks}
      source={makeSource()}
      __testInitialStatus="signing"
      __testSession={session}
    />,
  );
  ReactTestRenderer.act(() =>
    simulateWebViewMessage({ event: 'session_timeout' }),
  );
  expect(JSON.stringify(r.toJSON())).toContain('Restart');
});

test('reconnect from offline returns to idle', async () => {
  const r = render(
    <HookSigning
      {...callbacks}
      source={makeSource()}
      __testInitialStatus="offline"
    />,
  );
  await ReactTestRenderer.act(async () => {
    press(r, 'hook-check-connection-button');
    await flush();
  });
  expect(has(r, 'hook-sign-button')).toBe(true);
});
