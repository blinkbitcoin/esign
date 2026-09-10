import {
  createError,
  ErrorCodes,
  Errors,
  ESignError,
  getErrorCode,
} from '../errors';

describe('ESignError', () => {
  it('is an Error carrying the code twice: as `code` and as GraphQL-style extensions', () => {
    const error = new ESignError(ErrorCodes.ENVELOPE_NOT_FOUND, 'gone');
    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(ESignError);
    expect(error.name).toBe('ESignError');
    expect(error.message).toBe('gone');
    expect(error.code).toBe('ENVELOPE_NOT_FOUND');
    expect(error.extensions).toEqual({ code: 'ENVELOPE_NOT_FOUND' });
  });

  it('createError builds the same shape', () => {
    const error = createError(ErrorCodes.VALIDATION_ERROR, 'bad input');
    expect(error).toBeInstanceOf(ESignError);
    expect(error.code).toBe('VALIDATION_ERROR');
    expect(error.message).toBe('bad input');
  });
});

describe('ErrorCodes', () => {
  it('is the wire contract shared with the clients', () => {
    expect(ErrorCodes).toEqual({
      ENVELOPE_NOT_FOUND: 'ENVELOPE_NOT_FOUND',
      ENVELOPE_CREATION_FAILED: 'ENVELOPE_CREATION_FAILED',
      PROVIDER_UNAVAILABLE: 'PROVIDER_UNAVAILABLE',
      SESSION_EXPIRED: 'SESSION_EXPIRED',
      UNAUTHORIZED: 'UNAUTHORIZED',
      VALIDATION_ERROR: 'VALIDATION_ERROR',
      PERSISTENCE_FAILED: 'PERSISTENCE_FAILED',
    });
  });
});

describe('Errors factories', () => {
  it.each([
    ['unauthorized', 'UNAUTHORIZED', 'Authentication required'],
    ['envelopeNotFound', 'ENVELOPE_NOT_FOUND', 'Envelope not found'],
    [
      'envelopeCreationFailed',
      'ENVELOPE_CREATION_FAILED',
      'Failed to create envelope',
    ],
    [
      'providerUnavailable',
      'PROVIDER_UNAVAILABLE',
      'E-signature service temporarily unavailable',
    ],
    ['sessionExpired', 'SESSION_EXPIRED', 'Signing session has expired'],
    ['persistenceFailed', 'PERSISTENCE_FAILED', 'Failed to save envelope data'],
  ] as const)(
    '%s has a default message and accepts a custom one',
    (factory, code, message) => {
      const withDefault = Errors[factory]();
      expect(withDefault).toBeInstanceOf(ESignError);
      expect(withDefault.code).toBe(code);
      expect(withDefault.message).toBe(message);

      const custom = Errors[factory]('custom');
      expect(custom.code).toBe(code);
      expect(custom.message).toBe('custom');
    },
  );

  it('validationError always needs a message', () => {
    const error = Errors.validationError('name is required');
    expect(error.code).toBe('VALIDATION_ERROR');
    expect(error.message).toBe('name is required');
  });
});

describe('getErrorCode', () => {
  it('reads the code of a coded error', () => {
    expect(getErrorCode(Errors.providerUnavailable())).toBe(
      'PROVIDER_UNAVAILABLE',
    );
  });

  it('prefers GraphQL extensions over a top-level code', () => {
    expect(
      getErrorCode({ extensions: { code: 'FROM_EXTENSIONS' }, code: 'TOP' }),
    ).toBe('FROM_EXTENSIONS');
  });

  it('falls back to a top-level code when extensions carry none', () => {
    expect(getErrorCode({ extensions: {}, code: 'TOP' })).toBe('TOP');
    expect(getErrorCode({ code: 'ECONNRESET' })).toBe('ECONNRESET');
  });

  it('returns the fallback for uncoded objects, plain errors and non-objects', () => {
    expect(getErrorCode({})).toBe('UNKNOWN_ERROR');
    expect(getErrorCode(new Error('boom'))).toBe('UNKNOWN_ERROR');
    expect(getErrorCode(null)).toBe('UNKNOWN_ERROR');
    expect(getErrorCode(undefined)).toBe('UNKNOWN_ERROR');
    expect(getErrorCode('oops')).toBe('UNKNOWN_ERROR');
    expect(getErrorCode(42, 'CUSTOM')).toBe('CUSTOM');
    expect(getErrorCode({ code: '' }, 'EMPTY')).toBe('EMPTY');
  });
});
