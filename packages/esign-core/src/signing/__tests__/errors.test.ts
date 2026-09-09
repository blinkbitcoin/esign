import {
  isSigningSourceError,
  SigningSourceError,
  toSigningSourceError,
} from '../errors';

import type { SigningSourceError as SigningSourceErrorShape } from '../types';

describe('SigningSourceError', () => {
  it('is a real Error carrying the code', () => {
    const error = new SigningSourceError('SESSION_EXPIRED', 'expired');
    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(SigningSourceError);
    expect(error.name).toBe('SigningSourceError');
    expect(error.code).toBe('SESSION_EXPIRED');
    expect(error.message).toBe('expired');
    expect(error.stack).toEqual(expect.stringContaining('SigningSourceError'));
  });

  it('satisfies the wire shape and the `code in error` narrowing', () => {
    const error: unknown = new SigningSourceError('RESTART_FAILED');
    const shape: SigningSourceErrorShape = error as SigningSourceError;
    expect(shape.code).toBe('RESTART_FAILED');
    const hasCode = (value: unknown): boolean =>
      typeof value === 'object' && value !== null && 'code' in value;
    expect(hasCode(error)).toBe(true);
    expect(hasCode(null)).toBe(false);
    expect(error).toMatchObject({ code: 'RESTART_FAILED' });
  });

  it('defaults to an empty message', () => {
    expect(new SigningSourceError('X').message).toBe('');
  });
});

describe('isSigningSourceError', () => {
  it('is true only for instances', () => {
    expect(isSigningSourceError(new SigningSourceError('X'))).toBe(true);
    expect(isSigningSourceError({ code: 'X' })).toBe(false);
    expect(isSigningSourceError(new Error('X'))).toBe(false);
    expect(isSigningSourceError(null)).toBe(false);
  });
});

describe('toSigningSourceError', () => {
  it('passes an instance through untouched', () => {
    const error = new SigningSourceError('NETWORK_ERROR', 'slow');
    expect(toSigningSourceError(error, 'FALLBACK')).toBe(error);
  });

  it.each([
    [{ code: 'PROVIDER_UNAVAILABLE', message: 'down' }, 'down'],
    [{ code: 'PROVIDER_UNAVAILABLE' }, ''],
    [{ code: 'PROVIDER_UNAVAILABLE', message: 42 }, ''],
  ])('keeps the code of a wire-shaped object %o', (input, message) => {
    const error = toSigningSourceError(input, 'FALLBACK');
    expect(error).toBeInstanceOf(SigningSourceError);
    expect(error.code).toBe('PROVIDER_UNAVAILABLE');
    expect(error.message).toBe(message);
  });

  it('wraps an Error under the fallback code with its message', () => {
    const error = toSigningSourceError(new Error('http 500'), 'FALLBACK');
    expect(error).toBeInstanceOf(SigningSourceError);
    expect(error).toMatchObject({ code: 'FALLBACK', message: 'http 500' });
  });

  it.each([['weird'], [null], [undefined], [{ nope: true }], [{ code: 7 }]])(
    'maps a non-Error, non-coded rejection (%o) to the fallback code alone',
    input => {
      const error = toSigningSourceError(input, 'FALLBACK');
      expect(error).toMatchObject({ code: 'FALLBACK', message: '' });
    },
  );
});
