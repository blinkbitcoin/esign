// The webhook route end to end through the Fetch core, with the real
// envelope domain (@blinkbitcoin/esign-node) running over an in-memory
// store: outcomes are asserted on the stored status and audit trail.

import { randomUUID } from 'node:crypto';
import { vi } from 'vitest';

vi.mock('../src/store', async () => {
  const { memoryStore } = await import('./support/store');
  return { createStore: vi.fn(() => memoryStore) };
});

import type { EnvelopeStatus } from '@blinkbitcoin/esign-node';
import type { MockInstance } from 'vitest';
import type { DocuSignWebhookPayload } from '../src/providers/docusign';
import { asJson, get, post, testFullApp } from './support/app';
import { memoryStore as store } from './support/store';

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

// Helper to persist an envelope (unique ids per test: the in-memory store is
// shared across the file and never cleared)
const seedEnvelope = async (status: EnvelopeStatus = 'sent') =>
  store.createEnvelope({
    id: randomUUID(),
    providerEnvelopeId: `docusign-abc-${randomUUID()}`,
    userId: 'user-456',
    contractType: 'loan_agreement',
    status,
  });

// The route's answer in the shape the assertions below read
const answer = async (response: Response) => ({
  status: response.status,
  body: await asJson(response),
});

describe('Webhook Endpoint Integration', () => {
  let app: ReturnType<typeof testFullApp>;

  const postWebhook = (payload: DocuSignWebhookPayload, headers: HeadersInit = {}) =>
    post(app, '/webhook/esign', payload, headers).then(answer);

  let consoleWarnSpy: MockInstance;
  let consoleErrorSpy: MockInstance;
  let consoleLogSpy: MockInstance;

  beforeAll(() => {
    app = testFullApp();
  });

  afterAll(async () => {
    await app.stop();
  });

  // No DOCUSIGN_HMAC_KEY is configured in this suite, so every request hits
  // the expected dev-mode "not configured" warning. Some tests also
  // intentionally exercise malformed-JSON and DB-failure error paths, and a
  // successful request logs. The service composes the package on the
  // console and has no seam of its own, so this suite opts out of the
  // silent-tests gate (vitest.setup.ts) by spying on the console itself -
  // per test, so the spy sits on top of the gate's, never underneath it.
  beforeEach(() => {
    vi.clearAllMocks();
    consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleWarnSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    consoleLogSpy.mockRestore();
  });

  describe('POST /webhook/esign', () => {
    it('should return 200 OK for valid webhook payload', async () => {
      // Arrange
      const envelope = await seedEnvelope();
      const payload = createWebhookPayload(envelope.providerEnvelopeId, 'completed');

      // Act
      const response = await postWebhook(payload);

      // Assert
      expect(response.status).toBe(200);
      expect(response.body).toEqual({ received: true });
      expect((await store.getEnvelopeById(envelope.id))!.status).toBe('completed');
    });

    it('should parse JSON body correctly', async () => {
      // Arrange
      const envelope = await seedEnvelope();
      const payload = createWebhookPayload(envelope.providerEnvelopeId, 'completed');

      // Act
      await postWebhook(payload);

      // Assert - the payload was parsed and processed: the envelope matched by
      // its provider id was updated and the transition audited (PII-free)
      const updated = await store.getEnvelopeById(envelope.id);
      expect(updated!.status).toBe('completed');
      const audit = await store.listAuditEntries(envelope.id);
      expect(audit).toHaveLength(1);
      expect(audit[0]).toMatchObject({
        action: 'completed',
        metadata: { source: 'webhook' },
      });
    });

    it('should return 200 OK even for unknown envelope', async () => {
      // Arrange
      const payload = createWebhookPayload(`unknown-envelope-${randomUUID()}`, 'completed');

      // Act
      const response = await postWebhook(payload);

      // Assert - should still return 200 to prevent DocuSign retries
      expect(response.status).toBe(200);
      expect(response.body).toEqual({ received: true });
    });

    it('should return 200 and ignore an event with an unknown status', async () => {
      // Arrange - a Connect status outside the normalized vocabulary
      const envelope = await seedEnvelope();
      const payload = createWebhookPayload(envelope.providerEnvelopeId, 'delivered-to-mars');

      // Act
      const response = await postWebhook(payload);

      // Assert - acknowledged (no retry), nothing changed
      expect(response.status).toBe(200);
      expect((await store.getEnvelopeById(envelope.id))!.status).toBe('sent');
      expect(await store.listAuditEntries(envelope.id)).toEqual([]);
    });

    it('should be idempotent: a duplicate delivery adds no audit entry', async () => {
      // Arrange
      const envelope = await seedEnvelope();
      const payload = createWebhookPayload(envelope.providerEnvelopeId, 'completed');

      // Act - the same event delivered twice (DocuSign retries)
      const first = await postWebhook(payload);
      const second = await postWebhook(payload);

      // Assert
      expect(first.status).toBe(200);
      expect(second.status).toBe(200);
      expect((await store.getEnvelopeById(envelope.id))!.status).toBe('completed');
      expect(await store.listAuditEntries(envelope.id)).toHaveLength(1);
    });

    it('should refuse to downgrade a terminal envelope (replay protection)', async () => {
      // Arrange - an already completed envelope receives an older "sent" event
      const envelope = await seedEnvelope('completed');
      const payload = createWebhookPayload(envelope.providerEnvelopeId, 'sent');

      // Act
      const response = await postWebhook(payload);

      // Assert - acknowledged but ignored: status and audit trail unchanged
      expect(response.status).toBe(200);
      expect(response.body).toEqual({ received: true });
      expect((await store.getEnvelopeById(envelope.id))!.status).toBe('completed');
      expect(await store.listAuditEntries(envelope.id)).toEqual([]);
    });

    it('should return 500 when processing fails so DocuSign retries', async () => {
      // Arrange - simulate database error on the lookup
      const envelope = await seedEnvelope();
      const lookupSpy = vi
        .spyOn(store, 'getEnvelopeByProviderEnvelopeId')
        .mockRejectedValueOnce(new Error('Database connection failed'));
      const payload = createWebhookPayload(envelope.providerEnvelopeId, 'completed');

      // Act
      const response = await postWebhook(payload);

      // Assert - transient failure must trigger a DocuSign retry; the handler
      // is idempotent so the retried delivery converges to the right status
      expect(response.status).toBe(500);
      expect(response.body).toEqual({ error: 'Processing failed' });
      expect((await store.getEnvelopeById(envelope.id))!.status).toBe('sent');

      // The retry (DB recovered) converges
      const retry = await postWebhook(payload);
      expect(retry.status).toBe(200);
      expect((await store.getEnvelopeById(envelope.id))!.status).toBe('completed');
      expect(await store.listAuditEntries(envelope.id)).toHaveLength(1);

      lookupSpy.mockRestore();
    });

    it('should return 500 and roll back when the status update transaction fails', async () => {
      // Arrange - the lookup works but the write inside the transaction fails
      const envelope = await seedEnvelope();
      const updateSpy = vi
        .spyOn(store, 'updateEnvelopeStatus')
        .mockRejectedValueOnce(new Error('write failed'));
      const payload = createWebhookPayload(envelope.providerEnvelopeId, 'completed');

      // Act
      const response = await postWebhook(payload);

      // Assert - nothing half-applied
      expect(response.status).toBe(500);
      expect(response.body).toEqual({ error: 'Processing failed' });
      expect((await store.getEnvelopeById(envelope.id))!.status).toBe('sent');
      expect(await store.listAuditEntries(envelope.id)).toEqual([]);

      updateSpy.mockRestore();
    });

    it('should return 500 when processing throws a non-Error value', async () => {
      // Arrange - simulate a rejection that isn't an Error instance
      const envelope = await seedEnvelope();
      const lookupSpy = vi
        .spyOn(store, 'getEnvelopeByProviderEnvelopeId')
        .mockRejectedValueOnce('raw string failure');
      const payload = createWebhookPayload(envelope.providerEnvelopeId, 'completed');

      // Act
      const response = await postWebhook(payload);

      // Assert
      expect(response.status).toBe(500);
      expect(response.body).toEqual({ error: 'Processing failed' });
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'Webhook processing error:',
        'raw string failure'
      );

      lookupSpy.mockRestore();
    });

    it('should handle malformed JSON gracefully', async () => {
      // Act
      const response = await answer(await post(app, '/webhook/esign', 'not valid json'));

      // Assert - the provider's parser rejects it with 400
      // This is acceptable as it tells DocuSign not to retry invalid payloads
      expect(response.status).toBe(400);
    });

    it('should accept X-DocuSign-Signature-1 header', async () => {
      // Arrange - no HMAC key configured, so the header is not verified
      const envelope = await seedEnvelope();
      const payload = createWebhookPayload(envelope.providerEnvelopeId, 'completed');

      // Act
      const response = await postWebhook(payload, {
        'X-DocuSign-Signature-1': 'fake-hmac-signature',
      });

      // Assert
      expect(response.status).toBe(200);
      expect(response.body).toEqual({ received: true });
      expect((await store.getEnvelopeById(envelope.id))!.status).toBe('completed');
    });
  });

  describe('Health check', () => {
    it('should return 200 OK for health endpoint', async () => {
      // Act
      const response = await answer(await get(app, '/health'));

      // Assert
      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('status', 'ok');
      expect(response.body).toHaveProperty('timestamp');
    });
  });
});
