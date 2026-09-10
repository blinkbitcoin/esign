// E2E tests for webhook status updates
// Tests real database interactions when webhooks are received

import crypto from 'crypto';
import type { Express } from 'express';
import request from 'supertest';
import { createApp } from '../../src/app';
import { cleanTestData, createTestEnvelope } from './factories';
import { knex } from './setup';

describe('Webhook E2E Tests', () => {
  let app: Express;
  const testHmacKey = 'e2e-test-hmac-key';

  // Store original env value
  const originalHmacKey = process.env.DOCUSIGN_HMAC_KEY;

  beforeAll(async () => {
    app = await createApp();
  });

  beforeEach(async () => {
    await cleanTestData();
    // Set HMAC key for tests (dev mode allows without key, but we test with key)
    process.env.DOCUSIGN_HMAC_KEY = testHmacKey;
  });

  afterEach(() => {
    // Restore original env value
    if (originalHmacKey !== undefined) {
      process.env.DOCUSIGN_HMAC_KEY = originalHmacKey;
    } else {
      delete process.env.DOCUSIGN_HMAC_KEY;
    }
  });

  // Helper to compute valid HMAC signature
  const computeSignature = (body: string, key: string): string => {
    return crypto.createHmac('sha256', key).update(body, 'utf8').digest('base64');
  };

  // Create webhook payload
  const createWebhookPayload = (providerEnvelopeId: string, status: string) => ({
    event: `envelope-${status}`,
    apiVersion: 'v2.1',
    uri: `/restapi/v2.1/accounts/xxx/envelopes/${providerEnvelopeId}`,
    retryCount: 0,
    configurationId: 12345,
    generatedDateTime: new Date().toISOString(),
    data: {
      accountId: 'account-123',
      userId: 'user-456',
      envelopeId: providerEnvelopeId,
      envelopeSummary: {
        status,
        emailSubject: 'Test Document',
      },
    },
  });

  describe('POST /webhook/esign', () => {
    it('should update envelope status when webhook is received', async () => {
      // Arrange - create envelope with known providerEnvelopeId
      const envelope = await createTestEnvelope({
        providerEnvelopeId: 'ds-webhook-test-1',
        status: 'sent',
      });

      const payload = createWebhookPayload('ds-webhook-test-1', 'completed');
      const rawBody = JSON.stringify(payload);
      const validSignature = computeSignature(rawBody, testHmacKey);

      // Act - send webhook
      const response = await request(app)
        .post('/webhook/esign')
        .set('x-docusign-signature-1', validSignature)
        .set('Content-Type', 'application/json')
        .send(rawBody);

      // Assert - webhook accepted
      expect(response.status).toBe(200);
      expect(response.body).toEqual({ received: true });

      // Verify database was updated
      const updatedEnvelope = await knex('Envelope').where({ id: envelope.id }).first();

      expect(updatedEnvelope).not.toBeUndefined();
      expect(updatedEnvelope!.status).toBe('completed');
    });

    it('should create audit log when status is updated', async () => {
      // Arrange
      const envelope = await createTestEnvelope({
        providerEnvelopeId: 'ds-webhook-test-2',
        status: 'sent',
      });

      const payload = createWebhookPayload('ds-webhook-test-2', 'completed');
      const rawBody = JSON.stringify(payload);
      const validSignature = computeSignature(rawBody, testHmacKey);

      // Act
      await request(app)
        .post('/webhook/esign')
        .set('x-docusign-signature-1', validSignature)
        .set('Content-Type', 'application/json')
        .send(rawBody);

      // Assert - audit log created
      const auditLogs = await knex('AuditLog')
        .where({ envelopeId: envelope.id })
        .orderBy('timestamp', 'desc');

      expect(auditLogs.length).toBeGreaterThanOrEqual(1);
      const latestLog = auditLogs[0];
      expect(latestLog.action).toBe('completed');
      expect(latestLog.metadata).toMatchObject({ source: 'webhook' });
    });

    it('should handle declined status', async () => {
      // Arrange
      const envelope = await createTestEnvelope({
        providerEnvelopeId: 'ds-webhook-declined',
        status: 'sent',
      });

      const payload = createWebhookPayload('ds-webhook-declined', 'declined');
      const rawBody = JSON.stringify(payload);
      const validSignature = computeSignature(rawBody, testHmacKey);

      // Act
      await request(app)
        .post('/webhook/esign')
        .set('x-docusign-signature-1', validSignature)
        .set('Content-Type', 'application/json')
        .send(rawBody);

      // Assert
      const updatedEnvelope = await knex('Envelope').where({ id: envelope.id }).first();
      expect(updatedEnvelope!.status).toBe('declined');
    });

    it('should handle voided status', async () => {
      // Arrange
      const envelope = await createTestEnvelope({
        providerEnvelopeId: 'ds-webhook-voided',
        status: 'sent',
      });

      const payload = createWebhookPayload('ds-webhook-voided', 'voided');
      const rawBody = JSON.stringify(payload);
      const validSignature = computeSignature(rawBody, testHmacKey);

      // Act
      await request(app)
        .post('/webhook/esign')
        .set('x-docusign-signature-1', validSignature)
        .set('Content-Type', 'application/json')
        .send(rawBody);

      // Assert
      const updatedEnvelope = await knex('Envelope').where({ id: envelope.id }).first();
      expect(updatedEnvelope!.status).toBe('voided');
    });

    it('should be idempotent - no duplicate audit logs for same status', async () => {
      // Arrange
      const envelope = await createTestEnvelope({
        providerEnvelopeId: 'ds-webhook-idempotent',
        status: 'completed', // Already completed
      });

      const payload = createWebhookPayload('ds-webhook-idempotent', 'completed');
      const rawBody = JSON.stringify(payload);
      const validSignature = computeSignature(rawBody, testHmacKey);

      // Act - send same webhook twice
      await request(app)
        .post('/webhook/esign')
        .set('x-docusign-signature-1', validSignature)
        .set('Content-Type', 'application/json')
        .send(rawBody);

      await request(app)
        .post('/webhook/esign')
        .set('x-docusign-signature-1', validSignature)
        .set('Content-Type', 'application/json')
        .send(rawBody);

      // Assert - no audit logs created (status was already completed)
      const auditLogs = await knex('AuditLog').where({ envelopeId: envelope.id });

      expect(auditLogs).toHaveLength(0);
    });

    it('should return 200 for unknown envelope (graceful handling)', async () => {
      // Arrange - webhook for envelope that doesn't exist
      const payload = createWebhookPayload('ds-unknown-envelope', 'completed');
      const rawBody = JSON.stringify(payload);
      const validSignature = computeSignature(rawBody, testHmacKey);

      // Act
      const response = await request(app)
        .post('/webhook/esign')
        .set('x-docusign-signature-1', validSignature)
        .set('Content-Type', 'application/json')
        .send(rawBody);

      // Assert - returns 200 to prevent retries
      expect(response.status).toBe(200);
    });

    it('should return 401 for invalid signature', async () => {
      // Arrange
      await createTestEnvelope({
        providerEnvelopeId: 'ds-webhook-invalid-sig',
        status: 'sent',
      });

      const payload = createWebhookPayload('ds-webhook-invalid-sig', 'completed');
      const invalidSignature = 'aW52YWxpZC1zaWduYXR1cmU=';

      // Act
      const response = await request(app)
        .post('/webhook/esign')
        .set('x-docusign-signature-1', invalidSignature)
        .set('Content-Type', 'application/json')
        .send(JSON.stringify(payload));

      // Assert
      expect(response.status).toBe(401);
    });
  });
});
