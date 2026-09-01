// Integration tests for webhook endpoint using supertest
// Tests the full HTTP endpoint behavior

import request from 'supertest';
import { vi } from 'vitest';

vi.mock('../src/envelope');
vi.mock('../src/audit');
// handleDocuSignWebhook wraps its writes in knex.transaction; the repository
// calls inside are already mocked above, so a trivial transaction stub suffices
vi.mock('../src/db', () => ({
  knex: { transaction: (cb: (trx: unknown) => unknown) => cb({}) },
}));

import type { Express } from 'express';
import type { MockInstance } from 'vitest';
import { createApp } from '../src/app';
import { logAuditEvent } from '../src/audit';
import { getEnvelopeByProviderEnvelopeId, updateEnvelopeStatus } from '../src/envelope';
import type { DocuSignWebhookPayload } from '../src/providers/docusign';

const mockGetEnvelopeByProviderEnvelopeId = vi.mocked(getEnvelopeByProviderEnvelopeId);
const mockUpdateEnvelopeStatus = vi.mocked(updateEnvelopeStatus);
const mockLogAuditEvent = vi.mocked(logAuditEvent);

// Helper to create a mock DocuSign webhook payload
const createWebhookPayload = (envelopeId: string, status: string): DocuSignWebhookPayload => ({
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

describe('Webhook Endpoint Integration', () => {
  let app: Express;
  let consoleWarnSpy: MockInstance;
  let consoleErrorSpy: MockInstance;
  let consoleLogSpy: MockInstance;

  beforeAll(async () => {
    app = await createApp();
    // No DOCUSIGN_HMAC_KEY is configured in this suite, so every request
    // hits the expected dev-mode "not configured" warning. Some tests also
    // intentionally exercise malformed-JSON and DB-failure error paths, and
    // successful requests log via handleDocuSignWebhook's console.log.
    // Silence all three - they're expected, not unexpected failures.
    consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterAll(() => {
    consoleWarnSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    consoleLogSpy.mockRestore();
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('POST /webhook/esign', () => {
    it('should return 200 OK for valid webhook payload', async () => {
      // Arrange
      const mockEnvelope = createMockEnvelope();
      mockGetEnvelopeByProviderEnvelopeId.mockResolvedValue(mockEnvelope);
      mockUpdateEnvelopeStatus.mockResolvedValue({ ...mockEnvelope, status: 'completed' });
      mockLogAuditEvent.mockResolvedValue(undefined);

      const payload = createWebhookPayload('docusign-abc-123', 'completed');

      // Act
      const response = await request(app)
        .post('/webhook/esign')
        .send(payload)
        .set('Content-Type', 'application/json');

      // Assert
      expect(response.status).toBe(200);
      expect(response.body).toEqual({ received: true });
    });

    it('should parse JSON body correctly', async () => {
      // Arrange
      const mockEnvelope = createMockEnvelope();
      mockGetEnvelopeByProviderEnvelopeId.mockResolvedValue(mockEnvelope);
      mockUpdateEnvelopeStatus.mockResolvedValue({ ...mockEnvelope, status: 'completed' });
      mockLogAuditEvent.mockResolvedValue(undefined);

      const payload = createWebhookPayload('docusign-abc-123', 'completed');

      // Act
      await request(app)
        .post('/webhook/esign')
        .send(payload)
        .set('Content-Type', 'application/json');

      // Assert - verify the payload was parsed and processed
      expect(mockGetEnvelopeByProviderEnvelopeId).toHaveBeenCalledWith('docusign-abc-123');
    });

    it('should return 200 OK even for unknown envelope', async () => {
      // Arrange
      mockGetEnvelopeByProviderEnvelopeId.mockResolvedValue(null);

      const payload = createWebhookPayload('unknown-envelope', 'completed');

      // Act
      const response = await request(app)
        .post('/webhook/esign')
        .send(payload)
        .set('Content-Type', 'application/json');

      // Assert - should still return 200 to prevent DocuSign retries
      expect(response.status).toBe(200);
      expect(response.body).toEqual({ received: true });
    });

    it('should return 500 when processing fails so DocuSign retries', async () => {
      // Arrange - simulate database error
      mockGetEnvelopeByProviderEnvelopeId.mockRejectedValue(
        new Error('Database connection failed')
      );

      const payload = createWebhookPayload('docusign-abc-123', 'completed');

      // Act
      const response = await request(app)
        .post('/webhook/esign')
        .send(payload)
        .set('Content-Type', 'application/json');

      // Assert - transient failure must trigger a DocuSign retry; the handler
      // is idempotent so the retried delivery converges to the right status
      expect(response.status).toBe(500);
      expect(response.body).toEqual({ error: 'Processing failed' });
    });

    it('should return 500 when processing throws a non-Error value', async () => {
      // Arrange - simulate a rejection that isn't an Error instance
      mockGetEnvelopeByProviderEnvelopeId.mockRejectedValue('raw string failure');

      const payload = createWebhookPayload('docusign-abc-123', 'completed');

      // Act
      const response = await request(app)
        .post('/webhook/esign')
        .send(payload)
        .set('Content-Type', 'application/json');

      // Assert
      expect(response.status).toBe(500);
      expect(response.body).toEqual({ error: 'Processing failed' });
    });

    it('should handle malformed JSON gracefully', async () => {
      // Act
      const response = await request(app)
        .post('/webhook/esign')
        .send('not valid json')
        .set('Content-Type', 'application/json');

      // Assert - Express json() middleware returns 400 for malformed JSON
      // This is acceptable as it tells DocuSign not to retry invalid payloads
      expect(response.status).toBe(400);
    });

    it('should accept X-DocuSign-Signature-1 header', async () => {
      // Arrange
      const mockEnvelope = createMockEnvelope();
      mockGetEnvelopeByProviderEnvelopeId.mockResolvedValue(mockEnvelope);
      mockUpdateEnvelopeStatus.mockResolvedValue({ ...mockEnvelope, status: 'completed' });
      mockLogAuditEvent.mockResolvedValue(undefined);

      const payload = createWebhookPayload('docusign-abc-123', 'completed');

      // Act
      const response = await request(app)
        .post('/webhook/esign')
        .send(payload)
        .set('Content-Type', 'application/json')
        .set('X-DocuSign-Signature-1', 'fake-hmac-signature');

      // Assert
      expect(response.status).toBe(200);
      expect(response.body).toEqual({ received: true });
    });
  });

  describe('Health check', () => {
    it('should return 200 OK for health endpoint', async () => {
      // Act
      const response = await request(app).get('/health');

      // Assert
      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('status', 'ok');
      expect(response.body).toHaveProperty('timestamp');
    });
  });
});
