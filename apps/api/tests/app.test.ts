// Integration tests for Express app endpoints
// Tests webhook endpoint HMAC validation behavior

import crypto from 'crypto';
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

const mockGetEnvelopeByProviderEnvelopeId = vi.mocked(getEnvelopeByProviderEnvelopeId);
const mockUpdateEnvelopeStatus = vi.mocked(updateEnvelopeStatus);
const mockLogAuditEvent = vi.mocked(logAuditEvent);

describe('Express App Endpoints', () => {
  let app: Express;
  let consoleWarnSpy: MockInstance;
  let consoleErrorSpy: MockInstance;

  beforeAll(async () => {
    app = await createApp();
    // Silence expected console output: console.warn from the "unknown
    // envelope" and "HMAC key not configured" paths, console.error from the
    // security-event logging on invalid/missing HMAC signatures.
    consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterAll(() => {
    consoleWarnSpy.mockRestore();
    consoleErrorSpy.mockRestore();
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

    // Sample webhook payload
    const webhookPayload = {
      event: 'envelope-completed',
      apiVersion: 'v2.1',
      uri: '/restapi/v2.1/accounts/xxx/envelopes/xxx',
      retryCount: 0,
      configurationId: 12345,
      generatedDateTime: new Date().toISOString(),
      data: {
        accountId: 'account-123',
        userId: 'user-456',
        envelopeId: 'docusign-test-123',
        envelopeSummary: {
          status: 'completed',
          emailSubject: 'Test Document',
        },
      },
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
          .send(webhookPayload);

        // Assert
        expect(response.status).toBe(401);
        expect(response.body).toEqual({ error: 'Unauthorized' });
      });

      it('should return 401 for missing signature header', async () => {
        // Act - no signature header
        const response = await request(app).post('/webhook/esign').send(webhookPayload);

        // Assert
        expect(response.status).toBe(401);
        expect(response.body).toEqual({ error: 'Unauthorized' });
      });

      it('should return 200 for valid HMAC signature', async () => {
        // Arrange - use raw JSON string for HMAC computation
        const rawBody = JSON.stringify(webhookPayload);
        const validSignature = computeSignature(rawBody, testHmacKey);

        // Mock envelope lookup to return no envelope (unknown envelope case)
        mockGetEnvelopeByProviderEnvelopeId.mockResolvedValue(null);

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
        // Arrange
        const invalidSignature = 'aW52YWxpZA==';

        // Act
        await request(app)
          .post('/webhook/esign')
          .set('x-docusign-signature-1', invalidSignature)
          .send(webhookPayload);

        // Assert - database should NOT be accessed
        expect(mockGetEnvelopeByProviderEnvelopeId).not.toHaveBeenCalled();
        expect(mockUpdateEnvelopeStatus).not.toHaveBeenCalled();
        expect(mockLogAuditEvent).not.toHaveBeenCalled();
      });

      it('should process webhook ONLY after valid signature', async () => {
        // Arrange - use raw JSON string for HMAC computation
        const rawBody = JSON.stringify(webhookPayload);
        const validSignature = computeSignature(rawBody, testHmacKey);

        // Mock envelope lookup (return null for unknown envelope)
        mockGetEnvelopeByProviderEnvelopeId.mockResolvedValue(null);

        // Act - send raw body string with correct signature
        await request(app)
          .post('/webhook/esign')
          .set('x-docusign-signature-1', validSignature)
          .set('Content-Type', 'application/json')
          .send(rawBody);

        // Assert - database WAS accessed (validation passed)
        expect(mockGetEnvelopeByProviderEnvelopeId).toHaveBeenCalled();
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
        // Arrange
        mockGetEnvelopeByProviderEnvelopeId.mockResolvedValue(null);

        // Act - no signature, no HMAC key configured
        const response = await request(app).post('/webhook/esign').send(webhookPayload);

        // Assert - should allow in dev mode
        expect(response.status).toBe(200);
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
      // Authenticated, so it gets past UNAUTHORIZED - the mocked envelope
      // lookup returns undefined, so it resolves to ENVELOPE_NOT_FOUND
      // instead, proving the Bearer token was extracted as the userId.
      expect(response.body.errors?.[0]?.extensions?.code).toBe('ENVELOPE_NOT_FOUND');
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
