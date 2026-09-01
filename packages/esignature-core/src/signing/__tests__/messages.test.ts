import { getErrorMessage } from '../messages';

describe('getErrorMessage', () => {
  it.each([
    [
      'ENVELOPE_CREATION_FAILED',
      'Unable to create signing session. Please try again.',
    ],
    [
      'PERSISTENCE_FAILED',
      'Your signing session could not be saved. Please try again.',
    ],
    [
      'PROVIDER_UNAVAILABLE',
      'Signing service temporarily unavailable. Please try again later.',
    ],
    ['SESSION_EXPIRED', 'Session expired, tap to restart'],
    ['UNAUTHORIZED', 'You are not authorized to perform this action.'],
    ['ENVELOPE_NOT_FOUND', 'Signing session not found. Please try again.'],
    [
      'NETWORK_ERROR',
      'Connection lost. Please check your network and try again.',
    ],
  ])('maps %s to its message', (code, expected) => {
    expect(getErrorMessage(code)).toBe(expected);
  });

  it('uses the server message for VALIDATION_ERROR, with a fallback', () => {
    expect(getErrorMessage('VALIDATION_ERROR', 'Email is invalid')).toBe(
      'Email is invalid',
    );
    expect(getErrorMessage('VALIDATION_ERROR')).toBe(
      'Invalid input. Please check your information.',
    );
  });

  it('falls back to the server message then a generic message for unknown codes', () => {
    expect(getErrorMessage('SOME_NEW_CODE', 'raw detail')).toBe('raw detail');
    expect(getErrorMessage('SOME_NEW_CODE')).toBe(
      'An error occurred. Please try again.',
    );
  });
});
