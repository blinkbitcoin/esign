import { GraphQLError } from 'graphql';

// Error codes as const object for type safety
export const ErrorCodes = {
  ENVELOPE_NOT_FOUND: 'ENVELOPE_NOT_FOUND',
  ENVELOPE_CREATION_FAILED: 'ENVELOPE_CREATION_FAILED',
  PROVIDER_UNAVAILABLE: 'PROVIDER_UNAVAILABLE',
  SESSION_EXPIRED: 'SESSION_EXPIRED',
  UNAUTHORIZED: 'UNAUTHORIZED',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  PERSISTENCE_FAILED: 'PERSISTENCE_FAILED',
} as const;

// Type derived from ErrorCodes for type safety
export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];

// Factory function to create GraphQL errors with consistent structure
export const createError = (code: ErrorCode, message: string): GraphQLError => {
  return new GraphQLError(message, {
    extensions: { code },
  });
};

// Pre-built error factories for common cases
export const Errors = {
  unauthorized: (message = 'Authentication required') =>
    createError(ErrorCodes.UNAUTHORIZED, message),

  envelopeNotFound: (message = 'Envelope not found') =>
    createError(ErrorCodes.ENVELOPE_NOT_FOUND, message),

  envelopeCreationFailed: (message = 'Failed to create envelope') =>
    createError(ErrorCodes.ENVELOPE_CREATION_FAILED, message),

  providerUnavailable: (message = 'E-signature service temporarily unavailable') =>
    createError(ErrorCodes.PROVIDER_UNAVAILABLE, message),

  sessionExpired: (message = 'Signing session has expired') =>
    createError(ErrorCodes.SESSION_EXPIRED, message),

  validationError: (message: string) => createError(ErrorCodes.VALIDATION_ERROR, message),

  persistenceFailed: (message = 'Failed to save envelope data') =>
    createError(ErrorCodes.PERSISTENCE_FAILED, message),
};
