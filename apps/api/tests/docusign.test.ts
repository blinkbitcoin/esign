// Tests for DocuSign provider implementation
import { generateKeyPairSync } from 'crypto';
import type { MockInstance } from 'vitest';
import { vi } from 'vitest';
import { ErrorCodes } from '../src/errors';
import {
  clearTokenCache,
  DocuSignProvider,
  HttpError,
  RETRY_CONFIG,
  withRetry,
} from '../src/providers/docusign';

// Generate a valid test RSA key pair for JWT signing
const { privateKey: testPrivateKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
});

// Store original fetch
const originalFetch = global.fetch;

// Mock fetch for HTTP calls
const mockFetch = vi.fn();

describe('DocuSignProvider', () => {
  let consoleErrorSpy: MockInstance;

  beforeAll(() => {
    // Replace global fetch with mock
    global.fetch = mockFetch as unknown as typeof fetch;
    // Silence expected console.error output from tests that exercise
    // DocuSign's error/retry paths (e.g. 429/500 responses).
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterAll(() => {
    // Restore original fetch
    global.fetch = originalFetch;
    consoleErrorSpy.mockRestore();
  });

  beforeEach(() => {
    mockFetch.mockClear();
    clearTokenCache();

    // Set required env vars for testing
    process.env.DOCUSIGN_INTEGRATION_KEY = 'test-integration-key';
    // Use dynamically generated test RSA private key
    process.env.DOCUSIGN_PRIVATE_KEY = testPrivateKey;
    process.env.DOCUSIGN_USER_ID = 'test-user-id';
    process.env.DOCUSIGN_ACCOUNT_ID = 'test-account-id';
    process.env.DOCUSIGN_TEMPLATE_ID = 'test-template-id';
    process.env.DOCUSIGN_BASE_URL = 'https://demo.docusign.net/restapi';
    process.env.DOCUSIGN_OAUTH_URL = 'https://account-d.docusign.com';
  });

  afterEach(() => {
    // Clean up env vars
    delete process.env.DOCUSIGN_INTEGRATION_KEY;
    delete process.env.DOCUSIGN_PRIVATE_KEY;
    delete process.env.DOCUSIGN_USER_ID;
    delete process.env.DOCUSIGN_ACCOUNT_ID;
    delete process.env.DOCUSIGN_TEMPLATE_ID;
    delete process.env.DOCUSIGN_BASE_URL;
    delete process.env.DOCUSIGN_OAUTH_URL;
  });

  describe('createEnvelope', () => {
    it('should create envelope and return signing URL', async () => {
      // Arrange - mock successful responses
      // 1. OAuth token request
      // 2. Create envelope request
      // 3. Get signing URL request
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ access_token: 'test-token', expires_in: 3600 }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ envelopeId: 'env-123-456' }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ url: 'https://demo.docusign.net/signing/env-123-456' }),
        });

      // Act
      const result = await DocuSignProvider.createEnvelope('user-123', 'loan_agreement', {
        name: 'John Doe',
        email: 'john@example.com',
      });

      // Assert
      expect(result.envelopeId).toBe('env-123-456');
      expect(result.signingUrl).toBe('https://demo.docusign.net/signing/env-123-456');
      expect(mockFetch).toHaveBeenCalledTimes(3);
    });

    it('should send correct request payloads to DocuSign API', async () => {
      // Arrange
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ access_token: 'test-token', expires_in: 3600 }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ envelopeId: 'env-payload-test' }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ url: 'https://signing-url' }),
        });

      // Act
      await DocuSignProvider.createEnvelope('user-123', 'loan_agreement', {
        name: 'Jane Smith',
        email: 'jane@example.com',
      });

      // Assert - verify envelope creation request payload
      const envelopeCall = mockFetch.mock.calls[1];
      expect(envelopeCall[0]).toContain('/v2.1/accounts/test-account-id/envelopes');
      const envelopeBody = JSON.parse(envelopeCall[1].body);
      expect(envelopeBody.templateId).toBe('test-template-id');
      expect(envelopeBody.templateRoles[0].email).toBe('jane@example.com');
      expect(envelopeBody.templateRoles[0].name).toBe('Jane Smith');
      expect(envelopeBody.templateRoles[0].roleName).toBe('signer');
      expect(envelopeBody.templateRoles[0].clientUserId).toBe('jane@example.com'); // Required for embedded signing
      expect(envelopeBody.status).toBe('sent');

      // Assert - verify signing URL request payload
      const signingCall = mockFetch.mock.calls[2];
      expect(signingCall[0]).toContain('/views/recipient');
      const signingBody = JSON.parse(signingCall[1].body);
      expect(signingBody.email).toBe('jane@example.com');
      expect(signingBody.userName).toBe('Jane Smith');
      expect(signingBody.clientUserId).toBe('jane@example.com'); // Must match envelope creation
      expect(signingBody.authenticationMethod).toBe('none');
    });

    it('should use cached access token for subsequent calls', async () => {
      // Arrange - first call gets token, second reuses it
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ access_token: 'cached-token', expires_in: 3600 }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ envelopeId: 'env-1' }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ url: 'https://signing-url-1' }),
        })
        // Second createEnvelope call - no token request
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ envelopeId: 'env-2' }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ url: 'https://signing-url-2' }),
        });

      // Act
      await DocuSignProvider.createEnvelope('user-1', 'contract', {
        name: 'User 1',
        email: 'user1@example.com',
      });
      await DocuSignProvider.createEnvelope('user-2', 'contract', {
        name: 'User 2',
        email: 'user2@example.com',
      });

      // Assert - only 1 token request, not 2
      expect(mockFetch).toHaveBeenCalledTimes(5); // 1 token + 2*2 API calls
    });

    it('should dedupe concurrent token refreshes into a single request', async () => {
      // Arrange - two getEnvelopeStatus calls fired concurrently with no
      // cached token yet, so the second must wait on the first's in-flight
      // refresh instead of triggering its own token request. Every response
      // is identical so the exact fetch interleaving between the two calls
      // doesn't matter - only that dedup happened and both resolved.
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ access_token: 'shared-token', expires_in: 3600 }),
        })
        .mockResolvedValue({
          ok: true,
          json: () => Promise.resolve({ status: 'sent' }),
        });

      // Act - do NOT await individually; start both before either resolves
      const [status1, status2] = await Promise.all([
        DocuSignProvider.getEnvelopeStatus('env-concurrent-1'),
        DocuSignProvider.getEnvelopeStatus('env-concurrent-2'),
      ]);

      // Assert - both succeeded, but only 1 token request was made in total
      expect(status1).toBe('sent');
      expect(status2).toBe('sent');
      expect(mockFetch).toHaveBeenCalledTimes(3); // 1 token + 2 status calls
    });

    it('should throw ENVELOPE_CREATION_FAILED on 400 validation error', async () => {
      // Arrange - token succeeds, envelope creation fails with 400
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ access_token: 'test-token', expires_in: 3600 }),
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 400,
          text: () => Promise.resolve('Invalid recipient email'),
        });

      // Act & Assert
      await expect(
        DocuSignProvider.createEnvelope('user-123', 'loan_agreement', {
          name: 'John Doe',
          email: 'invalid-email',
        })
      ).rejects.toMatchObject({
        extensions: { code: ErrorCodes.ENVELOPE_CREATION_FAILED },
      });
    });

    it('should throw PROVIDER_UNAVAILABLE after max retries on 500 error', async () => {
      // Arrange - token succeeds, envelope creation fails with 500 repeatedly
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ access_token: 'test-token', expires_in: 3600 }),
        })
        // 3 failed attempts (max retries)
        .mockResolvedValueOnce({
          ok: false,
          status: 500,
          text: () => Promise.resolve('Internal Server Error'),
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 500,
          text: () => Promise.resolve('Internal Server Error'),
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 500,
          text: () => Promise.resolve('Internal Server Error'),
        });

      // Act & Assert
      await expect(
        DocuSignProvider.createEnvelope('user-123', 'loan_agreement', {
          name: 'John Doe',
          email: 'john@example.com',
        })
      ).rejects.toMatchObject({
        extensions: { code: ErrorCodes.PROVIDER_UNAVAILABLE },
      });

      // Should have attempted 3 times (token + 3 envelope attempts)
      expect(mockFetch).toHaveBeenCalledTimes(4);
    }, 15000); // Increase timeout for retries

    it('should retry on 429 rate limit and succeed', async () => {
      // Arrange - token succeeds, first envelope call returns 429, second succeeds
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ access_token: 'test-token', expires_in: 3600 }),
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 429,
          text: () => Promise.resolve('Rate limit exceeded'),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ envelopeId: 'env-after-retry' }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ url: 'https://signing-url' }),
        });

      // Act
      const result = await DocuSignProvider.createEnvelope('user-123', 'loan_agreement', {
        name: 'John Doe',
        email: 'john@example.com',
      });

      // Assert
      expect(result.envelopeId).toBe('env-after-retry');
      expect(mockFetch).toHaveBeenCalledTimes(4); // token + retry + envelope + signing URL
    }, 10000);

    it('should NOT retry on 401 authentication error', async () => {
      // Arrange - token request fails with 401
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        text: () => Promise.resolve('Unauthorized'),
      });

      // Act & Assert
      await expect(
        DocuSignProvider.createEnvelope('user-123', 'loan_agreement', {
          name: 'John Doe',
          email: 'john@example.com',
        })
      ).rejects.toMatchObject({
        extensions: { code: ErrorCodes.ENVELOPE_CREATION_FAILED },
      });

      // Should only have made 1 attempt (no retries for 4xx)
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
  });

  describe('getEnvelopeStatus', () => {
    it('should return correct status for sent envelope', async () => {
      // Arrange
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ access_token: 'test-token', expires_in: 3600 }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ status: 'sent' }),
        });

      // Act
      const status = await DocuSignProvider.getEnvelopeStatus('env-123');

      // Assert
      expect(status).toBe('sent');
    });

    it('should return correct status for completed envelope', async () => {
      // Arrange
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ access_token: 'test-token', expires_in: 3600 }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ status: 'completed' }),
        });

      // Act
      const status = await DocuSignProvider.getEnvelopeStatus('env-123');

      // Assert
      expect(status).toBe('completed');
    });

    it('should throw ENVELOPE_NOT_FOUND on 404', async () => {
      // Arrange
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ access_token: 'test-token', expires_in: 3600 }),
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 404,
          text: () => Promise.resolve('Envelope not found'),
        });

      // Act & Assert
      await expect(DocuSignProvider.getEnvelopeStatus('non-existent')).rejects.toMatchObject({
        extensions: { code: ErrorCodes.ENVELOPE_NOT_FOUND },
      });
    });

    it('should throw PROVIDER_UNAVAILABLE on 500 after retries', async () => {
      // Arrange
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ access_token: 'test-token', expires_in: 3600 }),
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 500,
          text: () => Promise.resolve('Server error'),
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 500,
          text: () => Promise.resolve('Server error'),
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 500,
          text: () => Promise.resolve('Server error'),
        });

      // Act & Assert
      await expect(DocuSignProvider.getEnvelopeStatus('env-123')).rejects.toMatchObject({
        extensions: { code: ErrorCodes.PROVIDER_UNAVAILABLE },
      });
    }, 15000);

    it('should map delivered status to sent', async () => {
      // Arrange
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ access_token: 'test-token', expires_in: 3600 }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ status: 'delivered' }),
        });

      // Act
      const status = await DocuSignProvider.getEnvelopeStatus('env-123');

      // Assert
      expect(status).toBe('sent');
    });

    it('should map voided status correctly', async () => {
      // Arrange
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ access_token: 'test-token', expires_in: 3600 }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ status: 'voided' }),
        });

      // Act
      const status = await DocuSignProvider.getEnvelopeStatus('env-123');

      // Assert
      expect(status).toBe('voided');
    });

    it('should map declined status correctly', async () => {
      // Arrange
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ access_token: 'test-token', expires_in: 3600 }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ status: 'declined' }),
        });

      // Act
      const status = await DocuSignProvider.getEnvelopeStatus('env-123');

      // Assert
      expect(status).toBe('declined');
    });

    it('should default unknown statuses to sent', async () => {
      // Arrange
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ access_token: 'test-token', expires_in: 3600 }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ status: 'some-future-docusign-status' }),
        });

      // Act
      const status = await DocuSignProvider.getEnvelopeStatus('env-123');

      // Assert
      expect(status).toBe('sent');
    });
  });

  describe('getSigningUrl', () => {
    it('should return a new signing URL for an existing envelope', async () => {
      // Arrange
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ access_token: 'test-token', expires_in: 3600 }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ url: 'https://demo.docusign.net/signing/env-123' }),
        });

      // Act
      const result = await DocuSignProvider.getSigningUrl('env-123', {
        name: 'John Doe',
        email: 'john@example.com',
      });

      // Assert
      expect(result.signingUrl).toBe('https://demo.docusign.net/signing/env-123');
    });

    it('should throw ENVELOPE_NOT_FOUND on 404', async () => {
      // Arrange
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ access_token: 'test-token', expires_in: 3600 }),
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 404,
          text: () => Promise.resolve('Envelope not found'),
        });

      // Act & Assert
      await expect(
        DocuSignProvider.getSigningUrl('non-existent', {
          name: 'John Doe',
          email: 'john@example.com',
        })
      ).rejects.toMatchObject({
        extensions: { code: ErrorCodes.ENVELOPE_NOT_FOUND },
      });
    });

    it('should throw ENVELOPE_NOT_FOUND on other 4xx client errors', async () => {
      // Arrange - a non-429 4xx that isn't specifically "not found" still
      // maps to ENVELOPE_NOT_FOUND for this endpoint (e.g. a voided/expired
      // envelope that DocuSign refuses to generate a signing view for)
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ access_token: 'test-token', expires_in: 3600 }),
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 400,
          text: () => Promise.resolve('Envelope is not in a signable state'),
        });

      // Act & Assert
      await expect(
        DocuSignProvider.getSigningUrl('env-123', {
          name: 'John Doe',
          email: 'john@example.com',
        })
      ).rejects.toMatchObject({
        extensions: { code: ErrorCodes.ENVELOPE_NOT_FOUND },
      });
    });

    it('should throw PROVIDER_UNAVAILABLE on 500 after retries', async () => {
      // Arrange
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ access_token: 'test-token', expires_in: 3600 }),
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 500,
          text: () => Promise.resolve('Server error'),
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 500,
          text: () => Promise.resolve('Server error'),
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 500,
          text: () => Promise.resolve('Server error'),
        });

      // Act & Assert
      await expect(
        DocuSignProvider.getSigningUrl('env-123', {
          name: 'John Doe',
          email: 'john@example.com',
        })
      ).rejects.toMatchObject({
        extensions: { code: ErrorCodes.PROVIDER_UNAVAILABLE },
      });
    }, 15000);
  });
});

describe('withRetry utility', () => {
  it('should return result on first successful attempt', async () => {
    // Arrange
    const fn = vi.fn().mockResolvedValue('success');

    // Act
    const result = await withRetry(fn);

    // Assert
    expect(result).toBe('success');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('should retry on failure and succeed', async () => {
    // Arrange
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error('Network error'))
      .mockResolvedValueOnce('success after retry');

    // Act
    const result = await withRetry(fn, { maxAttempts: 3, baseDelay: 10 });

    // Assert
    expect(result).toBe('success after retry');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('should throw after max retries exceeded', async () => {
    // Arrange
    const fn = vi.fn().mockRejectedValue(new Error('Persistent error'));

    // Act & Assert
    await expect(withRetry(fn, { maxAttempts: 3, baseDelay: 10 })).rejects.toThrow(
      'Persistent error'
    );
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('should not retry on 4xx HttpError (except 429)', async () => {
    // Arrange
    const fn = vi.fn().mockRejectedValue(new HttpError(400, 'Bad Request'));

    // Act & Assert
    await expect(withRetry(fn, { maxAttempts: 3, baseDelay: 10 })).rejects.toThrow('HTTP 400');
    expect(fn).toHaveBeenCalledTimes(1); // No retries
  });

  it('should retry on 429 HttpError', async () => {
    // Arrange
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new HttpError(429, 'Rate Limited'))
      .mockResolvedValueOnce('success after rate limit');

    // Act
    const result = await withRetry(fn, { maxAttempts: 3, baseDelay: 10 });

    // Assert
    expect(result).toBe('success after rate limit');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('should retry on 5xx HttpError', async () => {
    // Arrange
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new HttpError(503, 'Service Unavailable'))
      .mockResolvedValueOnce('success after 503');

    // Act
    const result = await withRetry(fn, { maxAttempts: 3, baseDelay: 10 });

    // Assert
    expect(result).toBe('success after 503');
    expect(fn).toHaveBeenCalledTimes(2);
  });
});

describe('HttpError', () => {
  it('should store status and body', () => {
    const error = new HttpError(404, 'Not Found');

    expect(error.status).toBe(404);
    expect(error.body).toBe('Not Found');
    expect(error.message).toBe('HTTP 404: Not Found');
    expect(error.name).toBe('HttpError');
  });
});

describe('RETRY_CONFIG', () => {
  it('should have correct default values', () => {
    expect(RETRY_CONFIG.maxAttempts).toBe(3);
    expect(RETRY_CONFIG.baseDelay).toBe(1000);
  });
});
