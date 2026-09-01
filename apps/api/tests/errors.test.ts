import { GraphQLError } from 'graphql';
import { createError, ErrorCodes, Errors } from '../src/errors';

describe('ErrorCodes', () => {
  it('should have all expected error codes', () => {
    expect(ErrorCodes.ENVELOPE_NOT_FOUND).toBe('ENVELOPE_NOT_FOUND');
    expect(ErrorCodes.ENVELOPE_CREATION_FAILED).toBe('ENVELOPE_CREATION_FAILED');
    expect(ErrorCodes.PROVIDER_UNAVAILABLE).toBe('PROVIDER_UNAVAILABLE');
    expect(ErrorCodes.SESSION_EXPIRED).toBe('SESSION_EXPIRED');
    expect(ErrorCodes.UNAUTHORIZED).toBe('UNAUTHORIZED');
    expect(ErrorCodes.VALIDATION_ERROR).toBe('VALIDATION_ERROR');
  });
});

describe('createError', () => {
  it('should create a GraphQL error with correct code', () => {
    const error = createError(ErrorCodes.UNAUTHORIZED, 'Test message');

    expect(error).toBeInstanceOf(GraphQLError);
    expect(error.message).toBe('Test message');
    expect(error.extensions?.code).toBe('UNAUTHORIZED');
  });
});

describe('Errors', () => {
  it('should create unauthorized error with default message', () => {
    const error = Errors.unauthorized();

    expect(error.message).toBe('Authentication required');
    expect(error.extensions?.code).toBe('UNAUTHORIZED');
  });

  it('should create unauthorized error with custom message', () => {
    const error = Errors.unauthorized('Custom auth error');

    expect(error.message).toBe('Custom auth error');
    expect(error.extensions?.code).toBe('UNAUTHORIZED');
  });

  it('should create envelopeNotFound error', () => {
    const error = Errors.envelopeNotFound();

    expect(error.message).toBe('Envelope not found');
    expect(error.extensions?.code).toBe('ENVELOPE_NOT_FOUND');
  });

  it('should create validationError with message', () => {
    const error = Errors.validationError('Invalid email format');

    expect(error.message).toBe('Invalid email format');
    expect(error.extensions?.code).toBe('VALIDATION_ERROR');
  });

  it('should create envelopeCreationFailed error with default message', () => {
    const error = Errors.envelopeCreationFailed();

    expect(error.message).toBe('Failed to create envelope');
    expect(error.extensions?.code).toBe('ENVELOPE_CREATION_FAILED');
  });

  it('should create providerUnavailable error with default message', () => {
    const error = Errors.providerUnavailable();

    expect(error.message).toBe('E-signature service temporarily unavailable');
    expect(error.extensions?.code).toBe('PROVIDER_UNAVAILABLE');
  });

  it('should create sessionExpired error with default message', () => {
    const error = Errors.sessionExpired();

    expect(error.message).toBe('Signing session has expired');
    expect(error.extensions?.code).toBe('SESSION_EXPIRED');
  });

  // Verify no technical details exposed
  describe('no technical details exposed', () => {
    it('providerUnavailable error never contains HTTP status codes', () => {
      const error = Errors.providerUnavailable();

      // Error should not contain technical details
      expect(error.message).not.toMatch(/HTTP \d{3}/);
      expect(error.message).not.toContain('500');
      expect(error.message).not.toContain('503');
      expect(error.message).not.toContain('429');
      expect(error.message).not.toContain('ECONNREFUSED');
      expect(error.message).not.toContain('timeout');

      // Should have user-friendly message
      expect(error.message).toBe('E-signature service temporarily unavailable');
    });

    it('error extensions only contain code, not raw error details', () => {
      const error = Errors.providerUnavailable();

      // Extensions should only have 'code' - no stack traces or raw errors
      expect(error.extensions).toBeDefined();
      expect(error.extensions?.code).toBe('PROVIDER_UNAVAILABLE');
      expect(Object.keys(error.extensions!)).toEqual(['code']);
    });

    it('all error factories produce user-friendly messages', () => {
      const errors = [
        Errors.unauthorized(),
        Errors.envelopeNotFound(),
        Errors.envelopeCreationFailed(),
        Errors.providerUnavailable(),
        Errors.sessionExpired(),
        Errors.validationError('Invalid input'),
      ];

      for (const error of errors) {
        // No technical jargon in any error message
        expect(error.message).not.toMatch(/exception|stack|trace|HTTP|ECONNREFUSED/i);
        // All should be GraphQL errors
        expect(error).toBeInstanceOf(GraphQLError);
      }
    });
  });
});
