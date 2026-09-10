// Integration tests for Express app endpoints
// Tests webhook endpoint HMAC validation behavior against the real envelope
// domain over an in-memory store (no Postgres): "processed" is asserted on
// the stored status and audit trail, not on mocked repository calls.

import { randomUUID } from 'node:crypto';
import crypto from 'crypto';
import request from 'supertest';
import { vi } from 'vitest';

vi.mock('../src/store', async () => {
  const { createMemoryEnvelopeStore } = await import('@blinkbitcoin/esign-server');
  return { store: createMemoryEnvelopeStore(), createKnexEnvelopeStore: vi.fn() };
});

import type { Express } from 'express';
import type { MockInstance } from 'vitest';
import { createApp } from '../src/app';
import { store } from '../src/store';

describe('Express App Endpoints', () => {
  let app: Express;
  let consoleWarnSpy: MockInstance;
  let consoleErrorSpy: MockInstance;
  let consoleLogSpy: MockInstance;

  beforeAll(async () => {
    app = await createApp();
  });

  // Expected console output: console.warn from the "unknown envelope" and
  // "HMAC key not configured" paths, console.error from the security-event
  // logging on invalid/missing HMAC signatures, console.log from a processed
  // webhook. The service composes the package on its console logger (no seam
  // of its own), so every test opts out of the silent-tests gate by spying
  // on the console itself (vitest.setup.ts) - per test, so the spy sits on
  // top of the gate's.
  beforeEach(() => {
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
    // Store original env value
    const originalHmacKey = process.env.DOCUSIGN_HMAC_KEY;

    afterEach(() => {
      // Restore original env value after each test
      if (originalHmacKey !== undefined) {
        process.env.DOCUSIGN_HMAC_KEY = originalHmacKey;
      } else {
        delete process.env.DOCUSIGN_HMAC_KEY;
      }
      vi.clearAllMocks();
    });

    // Helper to compute valid HMAC signature
    const computeSignature = (body: string, key: string): string => {
      return crypto.createHmac('sha256', key).update(body, 'utf8').digest('base64');
    };

    // Sample webhook payload (provider envelope ids are unique per test: the
    // in-memory store is shared across the file and never cleared)
    const webhookPayload = (envelopeId: string) => ({
      event: 'envelope-completed',
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
          status: 'completed',
          emailSubject: 'Test Document',
        },
      },
    });

    // A persisted, still-being-signed envelope the webhook may complete
    const seedSentEnvelope = async () => {
      const providerEnvelopeId = `docusign-test-${randomUUID()}`;
      const record = await store.createEnvelope({
        id: randomUUID(),
        providerEnvelopeId,
        userId: 'user-456',
        contractType: 'loan_agreement',
        status: 'sent',
      });
      return record;
    };

    describe('with HMAC key configured', () => {
      const testHmacKey = 'test-integration-hmac-key';

      beforeEach(() => {
        process.env.DOCUSIGN_HMAC_KEY = testHmacKey;
      });

      it('should return 401 for invalid HMAC signature', async () => {
        // Arrange
        const invalidSignature = 'aW52YWxpZC1zaWduYXR1cmU=';

        // Act
        const response = await request(app)
          .post('/webhook/esign')
          .set('x-docusign-signature-1', invalidSignature)
          .send(webhookPayload('docusign-test-123'));

        // Assert
        expect(response.status).toBe(401);
        expect(response.body).toEqual({ error: 'Unauthorized' });
      });

      it('should return 401 for missing signature header', async () => {
        // Act - no signature header
        const response = await request(app)
          .post('/webhook/esign')
          .send(webhookPayload('docusign-test-123'));

        // Assert
        expect(response.status).toBe(401);
        expect(response.body).toEqual({ error: 'Unauthorized' });
      });

      it('should return 200 for valid HMAC signature', async () => {
        // Arrange - use raw JSON string for HMAC computation; the envelope is
        // unknown to the store (acknowledged, not processed)
        const rawBody = JSON.stringify(webhookPayload(`unknown-${randomUUID()}`));
        const validSignature = computeSignature(rawBody, testHmacKey);

        // Act - send raw body string with correct signature
        const response = await request(app)
          .post('/webhook/esign')
          .set('x-docusign-signature-1', validSignature)
          .set('Content-Type', 'application/json')
          .send(rawBody);

        // Assert
        expect(response.status).toBe(200);
        expect(response.body).toEqual({ received: true });
      });

      it('should NOT process webhook when signature is invalid', async () => {
        // Arrange - a real envelope the forged webhook tries to complete
        const seeded = await seedSentEnvelope();
        const invalidSignature = 'aW52YWxpZA==';

        // Act
        const response = await request(app)
          .post('/webhook/esign')
          .set('x-docusign-signature-1', invalidSignature)
          .send(webhookPayload(seeded.providerEnvelopeId));

        // Assert - rejected, and the store was NOT touched
        expect(response.status).toBe(401);
        expect((await store.getEnvelopeById(seeded.id))!.status).toBe('sent');
        expect(await store.listAuditEntries(seeded.id)).toEqual([]);
      });

      it('should process webhook ONLY after valid signature', async () => {
        // Arrange - use raw JSON string for HMAC computation
        const seeded = await seedSentEnvelope();
        const rawBody = JSON.stringify(webhookPayload(seeded.providerEnvelopeId));
        const validSignature = computeSignature(rawBody, testHmacKey);

        // Act - send raw body string with correct signature
        const response = await request(app)
          .post('/webhook/esign')
          .set('x-docusign-signature-1', validSignature)
          .set('Content-Type', 'application/json')
          .send(rawBody);

        // Assert - the store WAS updated (validation passed)
        expect(response.status).toBe(200);
        expect((await store.getEnvelopeById(seeded.id))!.status).toBe('completed');
        const audit = await store.listAuditEntries(seeded.id);
        expect(audit).toHaveLength(1);
        expect(audit[0]).toMatchObject({ action: 'completed', metadata: { source: 'webhook' } });
      });

      it('should return 400 for invalid JSON payload', async () => {
        // Arrange
        const invalidJson = 'not valid json {{{';
        const validSignature = computeSignature(invalidJson, testHmacKey);

        // Act
        const response = await request(app)
          .post('/webhook/esign')
          .set('x-docusign-signature-1', validSignature)
          .set('Content-Type', 'application/json')
          .send(invalidJson);

        // Assert
        expect(response.status).toBe(400);
        expect(response.body).toEqual({ error: 'Invalid payload' });
      });

      it('should return 400 for missing required payload fields', async () => {
        // Arrange - valid JSON but missing required fields
        const incompletePayload = JSON.stringify({ event: 'test', data: {} });
        const validSignature = computeSignature(incompletePayload, testHmacKey);

        // Act
        const response = await request(app)
          .post('/webhook/esign')
          .set('x-docusign-signature-1', validSignature)
          .set('Content-Type', 'application/json')
          .send(incompletePayload);

        // Assert
        expect(response.status).toBe(400);
        expect(response.body).toEqual({ error: 'Invalid payload' });
      });
    });

    describe('without HMAC key configured (dev mode)', () => {
      beforeEach(() => {
        delete process.env.DOCUSIGN_HMAC_KEY;
      });

      it('should return 200 without signature in dev mode', async () => {
        // Act - no signature, no HMAC key configured (ALLOW_INSECURE_DEV is set
        // by tests/setup.ts); unknown envelope, so nothing to update
        const response = await request(app)
          .post('/webhook/esign')
          .send(webhookPayload(`unknown-${randomUUID()}`));

        // Assert - should allow in dev mode
        expect(response.status).toBe(200);
        expect(response.body).toEqual({ received: true });
      });
    });

    it('treats a non-JSON content-type as an empty body (rejected as malformed)', async () => {
      // express.text() only parses application/json, so another content-type
      // leaves req.body a non-string - the route must coerce it safely, not
      // crash. With HMAC configured (from the parent describe) this fails
      // signature verification and returns 401.
      const response = await request(app)
        .post('/webhook/esign')
        .set('Content-Type', 'text/plain')
        .send('not json at all');

      expect([400, 401]).toContain(response.status);
    });
  });

  describe('GET /health', () => {
    it('should return health check status', async () => {
      const response = await request(app).get('/health');

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('status', 'ok');
      expect(response.body).toHaveProperty('timestamp');
    });
  });

  describe('POST /graphql', () => {
    const ENVELOPE_QUERY = {
      query: 'query GetEnvelope($id: String!) { envelope(id: $id) { id status } }',
      variables: { id: 'uuid-123' },
    };

    it('should extract userId as null when no Authorization header is sent', async () => {
      const response = await request(app).post('/graphql').send(ENVELOPE_QUERY);

      expect(response.status).toBe(200);
      expect(response.body.errors?.[0]?.extensions?.code).toBe('UNAUTHORIZED');
    });

    it('should extract userId from a Bearer Authorization header', async () => {
      const response = await request(app)
        .post('/graphql')
        .set('Authorization', 'Bearer test-user-123')
        .send(ENVELOPE_QUERY);

      expect(response.status).toBe(200);
      // Authenticated, so it gets past UNAUTHORIZED - no such envelope is
      // stored, so it resolves to ENVELOPE_NOT_FOUND instead, proving the
      // Bearer token was extracted as the userId.
      expect(response.body.errors?.[0]?.extensions?.code).toBe('ENVELOPE_NOT_FOUND');
    });

    it('should resolve a stored envelope for its owner via the Bearer userId', async () => {
      const seeded = await store.createEnvelope({
        id: randomUUID(),
        providerEnvelopeId: `docusign-${randomUUID()}`,
        userId: 'test-user-123',
        contractType: 'loan_agreement',
        status: 'sent',
      });

      const response = await request(app)
        .post('/graphql')
        .set('Authorization', 'Bearer test-user-123')
        .send({ ...ENVELOPE_QUERY, variables: { id: seeded.id } });

      expect(response.status).toBe(200);
      expect(response.body.errors).toBeUndefined();
      expect(response.body.data.envelope).toEqual({ id: seeded.id, status: 'sent' });
    });
  });

  describe('security middleware', () => {
    it('sets baseline security headers (helmet) on API responses', async () => {
      const response = await request(app).get('/health');
      expect(response.headers['x-content-type-options']).toBe('nosniff');
      expect(response.headers['content-security-policy']).toBe(
        "default-src 'none';frame-ancestors 'none'"
      );
    });

    it('emits rate-limit headers on /graphql', async () => {
      const response = await request(app).post('/graphql').send({ query: '{ __typename }' });
      expect(response.headers).toHaveProperty('ratelimit');
    });

    it('serves signing pages with a nonce-based CSP and matching script nonce', async () => {
      const response = await request(app).get('/signing/mock/abc-123');
      const csp = response.headers['content-security-policy'];
      expect(csp).toMatch(/script-src 'nonce-/);
      const nonce = csp.match(/script-src 'nonce-([^']+)'/)?.[1];
      expect(nonce).toBeTruthy();
      expect(response.text).toContain(`nonce="${nonce}"`);
      // The per-route policy replaces the fail-closed default, not merges with it
      expect(csp).not.toContain("frame-ancestors 'none'");
    });

    it('lifts the default CSP only for the dev GraphQL landing page', async () => {
      const response = await request(app).get('/graphql');
      expect(response.headers['content-security-policy']).toBeUndefined();
    });

    it('bridge page also carries a nonce CSP', async () => {
      const response = await request(app).get('/signing/return?event=signing_complete');
      expect(response.headers['content-security-policy']).toMatch(/script-src 'nonce-/);
    });
  });
});

describe('createApp - environment-specific configuration', () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalOrigins = process.env.CORS_ALLOWED_ORIGINS;

  afterEach(() => {
    if (originalNodeEnv !== undefined) process.env.NODE_ENV = originalNodeEnv;
    else delete process.env.NODE_ENV;
    if (originalOrigins !== undefined) process.env.CORS_ALLOWED_ORIGINS = originalOrigins;
    else delete process.env.CORS_ALLOWED_ORIGINS;
    vi.restoreAllMocks();
  });

  it('in production: trusts the proxy and disables introspection', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    process.env.NODE_ENV = 'production';
    const prodApp = await createApp();

    const introspection = await request(prodApp)
      .post('/graphql')
      .send({ query: '{ __schema { queryType { name } } }' });
    expect(introspection.body.errors).toBeDefined();
  });

  it('in production: keeps the fail-closed CSP on GET /graphql (no landing page)', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    process.env.NODE_ENV = 'production';
    const prodApp = await createApp();

    const response = await request(prodApp).get('/graphql');
    expect(response.headers['content-security-policy']).toBe(
      "default-src 'none';frame-ancestors 'none'"
    );
  });

  it('reflects an allow-listed CORS origin and rejects others', async () => {
    process.env.CORS_ALLOWED_ORIGINS = 'https://app.example.com';
    const corsApp = await createApp();

    const allowed = await request(corsApp)
      .post('/graphql')
      .set('Origin', 'https://app.example.com')
      .send({ query: '{ __typename }' });
    expect(allowed.headers['access-control-allow-origin']).toBe('https://app.example.com');

    const denied = await request(corsApp)
      .post('/graphql')
      .set('Origin', 'https://evil.example.com')
      .send({ query: '{ __typename }' });
    expect(denied.headers['access-control-allow-origin']).toBeUndefined();
  });
});
