/**
 * @format
 */

import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import { Alert } from 'react-native';
import * as RN from 'react-native';
import App, {
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
