// Coded errors: the wire contract shared with the client packages (their
// generated ErrorCode enum and messages map onto these codes). Framework
// neutral - a GraphQL layer surfaces `extensions.code`, an HTTP layer maps
// codes to statuses.

export const ErrorCodes = {
  ENVELOPE_NOT_FOUND: 'ENVELOPE_NOT_FOUND',
  ENVELOPE_CREATION_FAILED: 'ENVELOPE_CREATION_FAILED',
  PROVIDER_UNAVAILABLE: 'PROVIDER_UNAVAILABLE',
  SESSION_EXPIRED: 'SESSION_EXPIRED',
  UNAUTHORIZED: 'UNAUTHORIZED',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  PERSISTENCE_FAILED: 'PERSISTENCE_FAILED',
} as const;

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];

// An error with a code. `extensions.code` mirrors GraphQL's convention so a
// GraphQL server (graphql-js copies a thrown error's extensions) and the
// existing clients see the same shape.
export class ESignError extends Error {
  readonly code: ErrorCode;
  readonly extensions: { code: ErrorCode };

  constructor(code: ErrorCode, message: string) {
    super(message);
    this.name = 'ESignError';
    this.code = code;
    this.extensions = { code };
  }
}

export const createError = (code: ErrorCode, message: string): ESignError =>
  new ESignError(code, message);

// Pre-built error factories for common cases
export const Errors = {
  unauthorized: (message = 'Authentication required') =>
    createError(ErrorCodes.UNAUTHORIZED, message),

  envelopeNotFound: (message = 'Envelope not found') =>
    createError(ErrorCodes.ENVELOPE_NOT_FOUND, message),

  envelopeCreationFailed: (message = 'Failed to create envelope') =>
    createError(ErrorCodes.ENVELOPE_CREATION_FAILED, message),

  providerUnavailable: (
    message = 'E-signature service temporarily unavailable',
  ) => createError(ErrorCodes.PROVIDER_UNAVAILABLE, message),

  sessionExpired: (message = 'Signing session has expired') =>
    createError(ErrorCodes.SESSION_EXPIRED, message),

  validationError: (message: string) =>
    createError(ErrorCodes.VALIDATION_ERROR, message),

  persistenceFailed: (message = 'Failed to save envelope data') =>
    createError(ErrorCodes.PERSISTENCE_FAILED, message),
};

// The code carried by any error shape we produce or receive (coded errors,
// GraphQL errors with extensions, plain objects with a code), else fallback
export const getErrorCode = (
  error: unknown,
  fallback = 'UNKNOWN_ERROR',
): string => {
  if (error && typeof error === 'object') {
    const candidate = error as {
      extensions?: { code?: string };
      code?: string;
    };
    return candidate.extensions?.code || candidate.code || fallback;
  }
  return fallback;
};
