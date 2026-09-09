// The error a SigningSource rejects with. A real Error (stack, instanceof,
// message) carrying the wire-shape `code` the components map to copy - the
// `SigningSourceError` interface in ./types stays the documented shape, this
// class satisfies it.

import type { SigningSourceError as SigningSourceErrorShape } from './types';

export class SigningSourceError
  extends Error
  implements SigningSourceErrorShape
{
  readonly code: string;

  constructor(code: string, message?: string) {
    super(message);
    this.name = 'SigningSourceError';
    this.code = code;
  }
}

/** True for an error thrown by a source (a SigningSourceError instance). */
export const isSigningSourceError = (
  error: unknown,
): error is SigningSourceError => error instanceof SigningSourceError;

// A plain object carrying the wire shape ({ code, message? }) - what an
// older source or a host-provided call may still reject with.
const isCodedObject = (error: unknown): error is SigningSourceErrorShape =>
  typeof error === 'object' &&
  error !== null &&
  typeof (error as { code?: unknown }).code === 'string';

/**
 * Normalize any rejection into a SigningSourceError: instances pass through
 * untouched, a wire-shaped object keeps its code, an Error is wrapped under
 * `fallbackCode` with its message, anything else gets `fallbackCode` alone.
 */
export const toSigningSourceError = (
  error: unknown,
  fallbackCode: string,
): SigningSourceError => {
  if (isSigningSourceError(error)) {
    return error;
  }
  if (isCodedObject(error)) {
    return new SigningSourceError(
      error.code,
      typeof error.message === 'string' ? error.message : undefined,
    );
  }
  return new SigningSourceError(
    fallbackCode,
    error instanceof Error ? error.message : undefined,
  );
};
