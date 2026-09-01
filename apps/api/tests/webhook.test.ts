// Tests for webhook handler
// Mocks the envelope/audit repository modules to avoid a real Postgres connection

import crypto from 'crypto';
import { vi } from 'vitest';

vi.mock('../src/envelope');
vi.mock('../src/audit');
// handleDocuSignWebhook wraps its writes in knex.transaction; the repository
// calls inside are already mocked above, so a trivial transaction stub suffices
vi.mock('../src/db', () => ({
  knex: { transaction: (cb: (trx: unknown) => unknown) => cb({}) },
}));

import { logAuditEvent } from '../src/audit';
import { getEnvelopeByProviderEnvelopeId, updateEnvelopeStatus } from '../src/envelope';
import type { DocuSignWebhookPayload } from '../src/providers/docusign';
import { DocuSignProvider } from '../src/providers/docusign';
import { handleWebhookEvent, validateHmac } from '../src/webhook';

// The pre-refactor entry point, recomposed from its two halves: the DocuSign
// adapter parses the Connect payload, the generic handler syncs the status.
// Payload-driven tests below exercise both.
const handleDocuSignWebhook = async (payload: DocuSignWebhookPayload): Promise<void> => {
  const event = DocuSignProvider.parseWebhookEvent(JSON.stringify(payload));
  if (!event) {
    throw new Error('test payload unexpectedly failed to parse');
  }
  await handleWebhookEvent(event);
};

import type { MockInstance } from 'vitest';

const mockGetEnvelopeByProviderEnvelopeId = vi.mocked(getEnvelopeByProviderEnvelopeId);
const mockUpdateEnvelopeStatus = vi.mocked(updateEnvelopeStatus);
const mockLogAuditEvent = vi.mocked(logAuditEvent);

// Helper to create a mock DocuSign webhook payload
const createWebhookPayload = (
  envelopeId: string,
  status: string,
  overrides: Partial<DocuSignWebhookPayload> = {}
): DocuSignWebhookPayload => ({
  event: `envelope-${status}`,
  apiVersion: 'v2.1',
  uri: '/restapi/v2.1/accounts/xxx/envelopes/xxx',
  retryCount: 0,
  configurationId: 12345,
  generatedDateTime: new Date().toISOString(),
  data: {
    accountId: 'account-123',
    userId: 'user-456',
    envelopeId,
    envelopeSummary: {
      status,
      emailSubject: 'Please sign this document',
    },
  },
  ...overrides,
});

// Helper to create a mock envelope
const createMockEnvelope = (overrides = {}) => ({
  id: 'uuid-internal-123',
  providerEnvelopeId: 'docusign-abc-123',
  userId: 'user-456',
  contractType: 'loan_agreement',
  status: 'sent',
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

describe('Webhook Handler', () => {
  let consoleLogSpy: MockInstance;

  beforeAll(() => {
    // Silence expected console.log output from handleDocuSignWebhook's
    // "processed"/"idempotent" status logging - it's normal operation, not
    // something these tests assert on.
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterAll(() => {
    consoleLogSpy.mockRestore();
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('handleDocuSignWebhook', () => {
    it('should update envelope status from sent to completed', async () => {
      // Arrange
      const mockEnvelope = createMockEnvelope({ status: 'sent' });
      mockGetEnvelopeByProviderEnvelopeId.mockResolvedValue(mockEnvelope);
      mockUpdateEnvelopeStatus.mockResolvedValue({ ...mockEnvelope, status: 'completed' });
      mockLogAuditEvent.mockResolvedValue(undefined);

      const payload = createWebhookPayload('docusign-abc-123', 'completed');

      // Act
      await handleDocuSignWebhook(payload);

      // Assert
      expect(mockGetEnvelopeByProviderEnvelopeId).toHaveBeenCalledWith('docusign-abc-123');
      expect(mockUpdateEnvelopeStatus).toHaveBeenCalledWith(
        'uuid-internal-123',
        'completed',
        expect.anything() // transaction
      );
      expect(mockLogAuditEvent).toHaveBeenCalledWith(
        'uuid-internal-123',
        'completed',
        expect.objectContaining({ source: 'webhook' }),
        expect.anything() // transaction
      );
    });

    it('should update envelope status from sent to declined', async () => {
      // Arrange
      const mockEnvelope = createMockEnvelope({ status: 'sent' });
      mockGetEnvelopeByProviderEnvelopeId.mockResolvedValue(mockEnvelope);
      mockUpdateEnvelopeStatus.mockResolvedValue({ ...mockEnvelope, status: 'declined' });
      mockLogAuditEvent.mockResolvedValue(undefined);

      const payload = createWebhookPayload('docusign-abc-123', 'declined');

      // Act
      await handleDocuSignWebhook(payload);

      // Assert
      expect(mockUpdateEnvelopeStatus).toHaveBeenCalledWith(
        'uuid-internal-123',
        'declined',
        expect.anything() // transaction
      );
      expect(mockLogAuditEvent).toHaveBeenCalledWith(
        'uuid-internal-123',
        'declined',
        expect.objectContaining({ source: 'webhook' }),
        expect.anything() // transaction
      );
    });

    it('should update envelope status from sent to voided', async () => {
      // Arrange
      const mockEnvelope = createMockEnvelope({ status: 'sent' });
      mockGetEnvelopeByProviderEnvelopeId.mockResolvedValue(mockEnvelope);
      mockUpdateEnvelopeStatus.mockResolvedValue({ ...mockEnvelope, status: 'voided' });
      mockLogAuditEvent.mockResolvedValue(undefined);

      const payload = createWebhookPayload('docusign-abc-123', 'voided');

      // Act
      await handleDocuSignWebhook(payload);

      // Assert
      expect(mockUpdateEnvelopeStatus).toHaveBeenCalledWith(
        'uuid-internal-123',
        'voided',
        expect.anything() // transaction
      );
      expect(mockLogAuditEvent).toHaveBeenCalledWith(
        'uuid-internal-123',
        'voided',
        expect.anything(),
        expect.anything() // transaction
      );
    });

    it('refuses to transition OUT of a terminal status (replay-downgrade guard)', async () => {
      // A captured, validly-signed older `sent` webhook is replayed after the
      // envelope has already reached the terminal `voided` state. The handler
      // must NOT downgrade it (which would re-enable session restart).
      const mockEnvelope = createMockEnvelope({ status: 'voided' });
      mockGetEnvelopeByProviderEnvelopeId.mockResolvedValue(mockEnvelope);

      const payload = createWebhookPayload('docusign-abc-123', 'sent');

      await handleDocuSignWebhook(payload);

      // No write, no audit entry - the terminal state is preserved
      expect(mockUpdateEnvelopeStatus).not.toHaveBeenCalled();
      expect(mockLogAuditEvent).not.toHaveBeenCalled();
    });

    it('should be idempotent - same status twice creates only one audit log', async () => {
      // Arrange - envelope already has the status being sent
      const mockEnvelope = createMockEnvelope({ status: 'completed' });
      mockGetEnvelopeByProviderEnvelopeId.mockResolvedValue(mockEnvelope);

      const payload = createWebhookPayload('docusign-abc-123', 'completed');

      // Act
      await handleDocuSignWebhook(payload);

      // Assert - no update, no audit log
      expect(mockUpdateEnvelopeStatus).not.toHaveBeenCalled();
      expect(mockLogAuditEvent).not.toHaveBeenCalled();
    });

    it('should handle unknown envelope gracefully - returns success, logs warning', async () => {
      // Arrange
      mockGetEnvelopeByProviderEnvelopeId.mockResolvedValue(null);
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const payload = createWebhookPayload('unknown-docusign-id', 'completed');

      // Act - should not throw
      await handleDocuSignWebhook(payload);

      // Assert
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('unknown envelope'));
      expect(mockUpdateEnvelopeStatus).not.toHaveBeenCalled();
      expect(mockLogAuditEvent).not.toHaveBeenCalled();

      consoleSpy.mockRestore();
    });

    it('should handle unknown status gracefully', async () => {
      // Arrange
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const payload = createWebhookPayload('docusign-abc-123', 'some_unknown_status');

      // Act - should not throw
      await handleDocuSignWebhook(payload);

      // Assert
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('unknown status'));
      expect(mockGetEnvelopeByProviderEnvelopeId).not.toHaveBeenCalled();
      expect(mockUpdateEnvelopeStatus).not.toHaveBeenCalled();

      consoleSpy.mockRestore();
    });

    it('should parse DocuSign Connect payload format correctly', async () => {
      // Arrange - realistic DocuSign Connect payload
      const mockEnvelope = createMockEnvelope();
      mockGetEnvelopeByProviderEnvelopeId.mockResolvedValue(mockEnvelope);
      mockUpdateEnvelopeStatus.mockResolvedValue({ ...mockEnvelope, status: 'completed' });
      mockLogAuditEvent.mockResolvedValue(undefined);

      const realPayload: DocuSignWebhookPayload = {
        event: 'envelope-completed',
        apiVersion: 'v2.1',
        uri: '/restapi/v2.1/accounts/abc123/envelopes/docusign-abc-123',
        retryCount: 0,
        configurationId: 67890,
        generatedDateTime: '2026-02-01T12:00:00.000Z',
        data: {
          accountId: 'abc123',
          userId: 'user-xyz',
          envelopeId: 'docusign-abc-123',
          envelopeSummary: {
            status: 'completed',
            emailSubject: 'Please sign: Loan Agreement',
          },
        },
      };

      // Act
      await handleDocuSignWebhook(realPayload);

      // Assert
      expect(mockGetEnvelopeByProviderEnvelopeId).toHaveBeenCalledWith('docusign-abc-123');
      expect(mockUpdateEnvelopeStatus).toHaveBeenCalled();
    });

    it('should handle case-insensitive status matching', async () => {
      // Arrange
      const mockEnvelope = createMockEnvelope({ status: 'sent' });
      mockGetEnvelopeByProviderEnvelopeId.mockResolvedValue(mockEnvelope);
      mockUpdateEnvelopeStatus.mockResolvedValue({ ...mockEnvelope, status: 'completed' });
      mockLogAuditEvent.mockResolvedValue(undefined);

      // DocuSign might send status in different cases
      const payload = createWebhookPayload('docusign-abc-123', 'COMPLETED');

      // Act
      await handleDocuSignWebhook(payload);

      // Assert - should still work
      expect(mockUpdateEnvelopeStatus).toHaveBeenCalledWith(
        'uuid-internal-123',
        'completed',
        expect.anything() // transaction
      );
    });
  });

  describe('validateHmac', () => {
    // Helper to compute valid HMAC signature for testing
    const computeValidSignature = (body: string, key: string): string => {
      const crypto = require('crypto');
      return crypto.createHmac('sha256', key).update(body, 'utf8').digest('base64');
    };

    describe('with HMAC key configured (production mode)', () => {
      const testHmacKey = 'test-secret-hmac-key-12345';

      it('should return true for valid HMAC signature', () => {
        // Arrange
        const testBody = '{"data":{"envelopeId":"test-123"}}';
        const validSignature = computeValidSignature(testBody, testHmacKey);

        // Act
        const result = validateHmac(validSignature, testBody, testHmacKey);

        // Assert
        expect(result).toBe(true);
      });

      it('should return false for invalid HMAC signature', () => {
        // Arrange
        const testBody = '{"data":{"envelopeId":"test-123"}}';
        const invalidSignature = 'aW52YWxpZC1zaWduYXR1cmU='; // base64 of 'invalid-signature'
        const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

        // Act
        const result = validateHmac(invalidSignature, testBody, testHmacKey);

        // Assert
        expect(result).toBe(false);
        expect(consoleSpy).toHaveBeenCalledWith(
          'Security event:',
          expect.stringContaining('timestamp')
        );

        consoleSpy.mockRestore();
      });

      it('should return false for missing signature when key is configured', () => {
        // Arrange
        const testBody = '{"data":{"envelopeId":"test-123"}}';
        const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

        // Act
        const result = validateHmac(undefined, testBody, testHmacKey);

        // Assert
        expect(result).toBe(false);
        expect(consoleSpy).toHaveBeenCalledWith(
          'Security event:',
          expect.stringContaining('timestamp')
        );

        consoleSpy.mockRestore();
      });

      it('should return false for empty signature when key is configured', () => {
        // Arrange
        const testBody = '{"data":{"envelopeId":"test-123"}}';
        const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

        // Act
        const result = validateHmac('', testBody, testHmacKey);

        // Assert
        expect(result).toBe(false);

        consoleSpy.mockRestore();
      });

      it('should use SHA256 algorithm as per DocuSign spec', () => {
        // Arrange - compute signature using SHA256
        const testBody = '{"test":"payload"}';
        const crypto = require('crypto');
        const sha256Signature = crypto
          .createHmac('sha256', testHmacKey)
          .update(testBody, 'utf8')
          .digest('base64');
        const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

        // Act
        const result = validateHmac(sha256Signature, testBody, testHmacKey);

        // Assert - SHA256 signature should be valid
        expect(result).toBe(true);

        // Verify SHA1 signature would NOT work (proving we use SHA256)
        const sha1Signature = crypto
          .createHmac('sha1', testHmacKey)
          .update(testBody, 'utf8')
          .digest('base64');
        const sha1Result = validateHmac(sha1Signature, testBody, testHmacKey);
        expect(sha1Result).toBe(false);

        consoleSpy.mockRestore();
      });

      it('should handle malformed base64 signature gracefully', () => {
        // Arrange
        const testBody = '{"data":{"envelopeId":"test-123"}}';
        const malformedSignature = '!!!not-valid-base64!!!';
        const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

        // Act
        const result = validateHmac(malformedSignature, testBody, testHmacKey);

        // Assert
        expect(result).toBe(false);
        expect(consoleSpy).toHaveBeenCalled();

        consoleSpy.mockRestore();
      });

      it('should log security event without PII on validation failure', () => {
        // Arrange
        const testBody = '{"data":{"envelopeId":"secret-123","recipientEmail":"test@example.com"}}';
        const invalidSignature = 'aW52YWxpZA==';
        const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

        // Act
        validateHmac(invalidSignature, testBody, testHmacKey);

        // Assert - log should NOT contain PII (email, envelope content)
        const logCalls = consoleSpy.mock.calls.map((call) => call.join(' ')).join(' ');
        expect(logCalls).not.toContain('test@example.com');
        expect(logCalls).not.toContain('secret-123');
        expect(logCalls).toContain('Security event');
        expect(logCalls).toContain('timestamp');

        consoleSpy.mockRestore();
      });

      it('should log security event with IP address when provided (Task 3.1)', () => {
        // Arrange
        const testBody = '{"data":"test"}';
        const invalidSignature = 'aW52YWxpZA==';
        const testIp = '192.168.1.100';
        const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

        // Act
        validateHmac(invalidSignature, testBody, testHmacKey, testIp);

        // Assert - log should contain IP
        const logCalls = consoleSpy.mock.calls.map((call) => call.join(' ')).join(' ');
        expect(logCalls).toContain(testIp);
        expect(logCalls).toContain('timestamp');

        consoleSpy.mockRestore();
      });

      it('should use timing-safe comparison to prevent timing attacks', () => {
        // Arrange - create two signatures that differ only in last character
        const testBody = '{"data":"test"}';
        const validSignature = computeValidSignature(testBody, testHmacKey);
        const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

        // Corrupt the signature slightly
        const corruptedSignature = validSignature.slice(0, -1) + 'X';

        // Act - both should complete in similar time (timing-safe)
        // We can't directly test timing, but we verify it returns false for corrupted
        const validResult = validateHmac(validSignature, testBody, testHmacKey);
        const invalidResult = validateHmac(corruptedSignature, testBody, testHmacKey);

        // Assert
        expect(validResult).toBe(true);
        expect(invalidResult).toBe(false);

        consoleSpy.mockRestore();
      });

      it('should return false for a same-length signature with different content', () => {
        // Arrange - flip one character in the middle so the decoded byte
        // length is unchanged, forcing timingSafeEqual to actually run and
        // return false (rather than short-circuiting on a length mismatch)
        const testBody = '{"data":"test"}';
        const validSignature = computeValidSignature(testBody, testHmacKey);
        const chars = validSignature.split('');
        chars[2] = chars[2] === 'A' ? 'B' : 'A';
        const corruptedSignature = chars.join('');
        const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

        // Act
        const result = validateHmac(corruptedSignature, testBody, testHmacKey);

        // Assert
        expect(result).toBe(false);
        expect(consoleSpy).toHaveBeenCalledWith(
          'Security event:',
          expect.stringContaining('HMAC signature verification failed')
        );

        consoleSpy.mockRestore();
      });

      it('should return false and log when signature comparison throws', () => {
        // Arrange - force crypto.timingSafeEqual to throw, exercising the
        // defensive catch block around malformed base64/crypto errors
        const testBody = '{"data":"test"}';
        const validSignature = computeValidSignature(testBody, testHmacKey);
        const timingSafeEqualSpy = vi.spyOn(crypto, 'timingSafeEqual').mockImplementation(() => {
          throw new Error('simulated crypto failure');
        });
        const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

        // Act
        const result = validateHmac(validSignature, testBody, testHmacKey);

        // Assert
        expect(result).toBe(false);
        expect(consoleSpy).toHaveBeenCalledWith(
          'Security event:',
          expect.stringContaining('HMAC validation error - simulated crypto failure')
        );

        timingSafeEqualSpy.mockRestore();
        consoleSpy.mockRestore();
      });

      it('should log "unknown error" when signature comparison throws a non-Error', () => {
        // Arrange - force a throw that isn't an Error instance
        const testBody = '{"data":"test"}';
        const validSignature = computeValidSignature(testBody, testHmacKey);
        const timingSafeEqualSpy = vi.spyOn(crypto, 'timingSafeEqual').mockImplementation(() => {
          throw 'a non-Error rejection';
        });
        const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

        // Act
        const result = validateHmac(validSignature, testBody, testHmacKey);

        // Assert
        expect(result).toBe(false);
        expect(consoleSpy).toHaveBeenCalledWith(
          'Security event:',
          expect.stringContaining('HMAC validation error - unknown error')
        );

        timingSafeEqualSpy.mockRestore();
        consoleSpy.mockRestore();
      });

      it('should validate signature for empty body', () => {
        // Arrange
        const emptyBody = '';
        const validSignature = computeValidSignature(emptyBody, testHmacKey);

        // Act
        const result = validateHmac(validSignature, emptyBody, testHmacKey);

        // Assert
        expect(result).toBe(true);
      });

      it('should validate signature for large payload', () => {
        // Arrange
        const largeBody = JSON.stringify({ data: 'x'.repeat(10000) });
        const validSignature = computeValidSignature(largeBody, testHmacKey);

        // Act
        const result = validateHmac(validSignature, largeBody, testHmacKey);

        // Assert
        expect(result).toBe(true);
      });
    });

    describe('without HMAC key configured (dev mode)', () => {
      it('should return true with warning when HMAC key not configured (dev mode fallback)', () => {
        // Arrange
        const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const testBody = '{"data":"test"}';

        // Act
        const result = validateHmac('any-signature', testBody, undefined);

        // Assert - should allow request but warn
        expect(result).toBe(true);
        expect(consoleSpy).toHaveBeenCalledWith(
          expect.stringContaining('Webhook HMAC key not configured')
        );

        consoleSpy.mockRestore();
      });

      it('should return true even with missing signature in dev mode', () => {
        // Arrange
        const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const testBody = '{"data":"test"}';

        // Act
        const result = validateHmac(undefined, testBody, undefined);

        // Assert
        expect(result).toBe(true);
        expect(consoleSpy).toHaveBeenCalledWith(
          expect.stringContaining('Webhook HMAC key not configured')
        );

        consoleSpy.mockRestore();
      });
    });

    describe('without HMAC key configured, insecure-dev NOT allowed (fail-closed)', () => {
      const originalInsecureDev = process.env.ALLOW_INSECURE_DEV;

      beforeEach(() => {
        delete process.env.ALLOW_INSECURE_DEV;
      });

      afterEach(() => {
        if (originalInsecureDev !== undefined) {
          process.env.ALLOW_INSECURE_DEV = originalInsecureDev;
        } else {
          delete process.env.ALLOW_INSECURE_DEV;
        }
      });

      it('should reject webhooks and log a security event when HMAC key is missing', () => {
        // Arrange
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        const testBody = '{"data":"test"}';

        // Act - even a request carrying a signature must be rejected: with no
        // key configured there is nothing to verify it against
        const result = validateHmac('any-signature', testBody, undefined);

        // Assert - fail closed, never silently accept unauthenticated webhooks
        expect(result).toBe(false);
        expect(errorSpy).toHaveBeenCalledWith(
          'Security event:',
          expect.stringContaining('Webhook HMAC key not configured')
        );

        errorSpy.mockRestore();
      });

      it('should reject webhooks with missing signature when fail-closed', () => {
        // Arrange
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        const testBody = '{"data":"test"}';

        // Act
        const result = validateHmac(undefined, testBody, undefined);

        // Assert
        expect(result).toBe(false);

        errorSpy.mockRestore();
      });
    });
  });
});

describe('DocuSignProvider webhook adapter', () => {
  describe('parseWebhookEvent', () => {
    it('normalizes a valid Connect payload into a webhook event', () => {
      const payload = createWebhookPayload('docusign-abc-123', 'completed');

      const event = DocuSignProvider.parseWebhookEvent(JSON.stringify(payload));

      expect(event).toEqual({
        providerEnvelopeId: 'docusign-abc-123',
        status: 'completed',
        rawStatus: 'completed',
      });
    });

    it('maps unknown statuses to null while preserving the raw status', () => {
      const payload = createWebhookPayload('docusign-abc-123', 'some_unknown_status');

      const event = DocuSignProvider.parseWebhookEvent(JSON.stringify(payload));

      expect(event).toEqual({
        providerEnvelopeId: 'docusign-abc-123',
        status: null,
        rawStatus: 'some_unknown_status',
      });
    });

    it('returns null for invalid JSON', () => {
      expect(DocuSignProvider.parseWebhookEvent('not valid json')).toBeNull();
    });

    it('returns null when envelopeId is missing', () => {
      const payload = createWebhookPayload('docusign-abc-123', 'completed');
      payload.data.envelopeId = '';

      expect(DocuSignProvider.parseWebhookEvent(JSON.stringify(payload))).toBeNull();
    });

    it('returns null when status is missing', () => {
      const payload = createWebhookPayload('docusign-abc-123', 'completed');
      payload.data.envelopeSummary.status = '';

      expect(DocuSignProvider.parseWebhookEvent(JSON.stringify(payload))).toBeNull();
    });

    it('returns null for a payload without a data object', () => {
      expect(DocuSignProvider.parseWebhookEvent('{"event":"envelope-completed"}')).toBeNull();
    });
  });

  describe('verifyWebhook', () => {
    const testHmacKey = 'test-secret-hmac-key-12345';
    const originalHmacKey = process.env.DOCUSIGN_HMAC_KEY;

    beforeEach(() => {
      process.env.DOCUSIGN_HMAC_KEY = testHmacKey;
    });

    afterEach(() => {
      if (originalHmacKey !== undefined) {
        process.env.DOCUSIGN_HMAC_KEY = originalHmacKey;
      } else {
        delete process.env.DOCUSIGN_HMAC_KEY;
      }
    });

    const sign = (body: string): string =>
      crypto.createHmac('sha256', testHmacKey).update(body, 'utf8').digest('base64');

    it('accepts a request signed in the X-DocuSign-Signature-1 header', () => {
      const body = '{"data":"test"}';

      const result = DocuSignProvider.verifyWebhook({ 'x-docusign-signature-1': sign(body) }, body);

      expect(result).toBe(true);
    });

    it('rejects a request without the signature header', () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const result = DocuSignProvider.verifyWebhook({}, '{"data":"test"}');

      expect(result).toBe(false);
      errorSpy.mockRestore();
    });

    it('treats a repeated (array-valued) signature header as missing', () => {
      const body = '{"data":"test"}';
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const result = DocuSignProvider.verifyWebhook(
        { 'x-docusign-signature-1': [sign(body), sign(body)] },
        body
      );

      expect(result).toBe(false);
      errorSpy.mockRestore();
    });
  });
});
