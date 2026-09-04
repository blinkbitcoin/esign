/**
 * @format
 */

import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import { Alert } from 'react-native';
import * as RN from 'react-native';
import App, {
  BLINK_THEME,
  getRecipientData,
  handleSigningComplete,
  handleSigningError,
  handleSigningCancel,
} from '../App';

test('renders correctly', async () => {
  await ReactTestRenderer.act(() => {
    ReactTestRenderer.create(<App />);
  });
});

test('"Start over" remounts the ESignature component', async () => {
  let renderer: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(() => {
    renderer = ReactTestRenderer.create(<App />);
  });

  const before = renderer!.root.findByProps({ testID: 'sign-document-button' });
  const reset = renderer!.root.findByProps({ testID: 'reset-button' });
  await ReactTestRenderer.act(() => {
    reset.props.onPress();
  });

  // A new instance (key change) is mounted, again in the idle state
  const after = renderer!.root.findByProps({ testID: 'sign-document-button' });
  expect(after).not.toBe(before);
  expect(
    renderer!.root.findAllByProps({ testID: 'sign-document-button' }).length,
  ).toBeGreaterThan(0);
});

test('the toolbar cycles default → themed → hook → default', async () => {
  let renderer: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(() => {
    renderer = ReactTestRenderer.create(<App />);
  });
  const count = (testID: string) =>
    renderer!.root.findAllByProps({ testID }).length;
  const toggle = renderer!.root.findByProps({ testID: 'ui-mode-button' });
  const press = () =>
    ReactTestRenderer.act(() => {
      toggle.props.onPress();
    });

  expect(JSON.stringify(renderer!.toJSON())).toContain('Sign Document');

  await press(); // themed: same component, Blink colors + Esaú's label
  expect(count('sign-document-button')).toBeGreaterThan(0);
  const json = JSON.stringify(renderer!.toJSON());
  expect(json).toContain('Sign the agreement');
  expect(json).toContain(BLINK_THEME.primaryColor);

  await press(); // hook: host-owned screen
  expect(count('hook-sign-button')).toBeGreaterThan(0);
  expect(count('sign-document-button')).toBe(0);

  await press(); // back to default
  expect(count('sign-document-button')).toBeGreaterThan(0);
  expect(JSON.stringify(renderer!.toJSON())).toContain('Sign Document');
});

test('renders with light-content status bar in dark mode', async () => {
  const colorSchemeSpy = jest
    .spyOn(RN, 'useColorScheme')
    .mockReturnValue('dark');

  let renderer: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(() => {
    renderer = ReactTestRenderer.create(<App />);
  });

  const statusBar = renderer!.root.findByType(RN.StatusBar);
  expect(statusBar.props.barStyle).toBe('light-content');

  colorSchemeSpy.mockRestore();
});

describe('getRecipientData', () => {
  it('returns the E2E test recipient in development', () => {
    expect(getRecipientData()).toEqual({
      name: 'Test User',
      email: 'test@example.com',
    });
  });
});

describe('handleSigningComplete', () => {
  it('shows a success alert with the envelope ID', () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});

    handleSigningComplete({ envelopeId: 'env-123', status: 'completed' });

    expect(alertSpy).toHaveBeenCalledWith(
      'Success',
      'Document signed! Envelope: env-123',
    );

    alertSpy.mockRestore();
  });
});

describe('handleSigningError', () => {
  it('logs the error code and message without showing an alert', () => {
    const consoleLogSpy = jest
      .spyOn(console, 'log')
      .mockImplementation(() => {});
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});

    handleSigningError({
      code: 'PROVIDER_UNAVAILABLE',
      message: 'Service down',
    });

    expect(consoleLogSpy).toHaveBeenCalledWith(
      'ESignature error:',
      'PROVIDER_UNAVAILABLE',
      'Service down',
    );
    expect(alertSpy).not.toHaveBeenCalled();

    consoleLogSpy.mockRestore();
    alertSpy.mockRestore();
  });
});

describe('handleSigningCancel', () => {
  it('shows a cancelled alert', () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});

    handleSigningCancel();

    expect(alertSpy).toHaveBeenCalledWith(
      'Cancelled',
      'Signing was cancelled.',
    );

    alertSpy.mockRestore();
  });
});

describe('App integration', () => {
  it('shows a cancelled alert when the cancel button is pressed', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    let renderer: ReactTestRenderer.ReactTestRenderer;

    await ReactTestRenderer.act(() => {
      renderer = ReactTestRenderer.create(<App />);
    });

    const cancelButton = renderer!.root.findByProps({
      testID: 'cancel-button',
    });

    await ReactTestRenderer.act(() => {
      cancelButton.props.onPress();
    });

    expect(alertSpy).toHaveBeenCalledWith(
      'Cancelled',
      'Signing was cancelled.',
    );

    alertSpy.mockRestore();
  });
});
