// The Fetch core: which routes exist for which capabilities, what the boot
// guard refuses, and the policy (auth, CORS, security headers, locked terms)
// around them.
//
// The envelope half runs against the real envelope domain over an in-memory
// store (no Postgres): "processed" is asserted on the stored status and the
// audit trail, never on a mocked repository call.

import { randomUUID } from 'node:crypto';
import crypto from 'crypto';
import { vi } from 'vitest';

vi.mock('../src/store', async () => {
  const { createMemoryEnvelopeStore } = await import('@blinkbitcoin/esign-node');
  return { store: createMemoryEnvelopeStore(), createKnexEnvelopeStore: vi.fn() };
});

import { createESignApp } from '../src/app';
import { store } from '../src/store';
import { asJson, get, options, post, silently, testApp, testFullApp } from './support/app';

const mintHeaders = { authorization: 'Bearer user-1' };

describe('capabilities', () => {
  it('reports the mint alone without DATABASE_URL', async () => {
    const app = testApp();
    expect(app.capabilities).toEqual(['mint']);

    const body = await asJson(await get(app, '/health'));
    expect(body).toMatchObject({ status: 'ok', capabilities: ['mint'] });
    expect(body).toHaveProperty('timestamp');
  });

  it('adds envelopes with DATABASE_URL', async () => {
    const app = testFullApp();
    expect(app.capabilities).toEqual(['mint', 'envelopes']);

    expect(await asJson(await get(app, '/health'))).toMatchObject({
      capabilities: ['mint', 'envelopes'],
    });
    await app.stop();
  });

  it('has no webhook and no GraphQL route without a database', async () => {
    const app = testApp();

    expect((await post(app, '/webhook/esign', { event: 'envelope-completed' })).status).toBe(404);
    expect((await post(app, '/graphql', { query: '{ __typename }' })).status).toBe(404);
  });

  it('answers 404 for anything it does not serve', async () => {
    const response = await get(testApp(), '/nope');

    expect(response.status).toBe(404);
    expect(await asJson(response)).toEqual({ error: 'Not found' });
  });

  it('refuses to construct when the configuration is wrong', () => {
    expect(() => createESignApp({ ESIGN_PROVIDER: 'mock' })).toThrow(/Refusing to start/);
  });

  it('refuses a database it was not built to serve (no envelope module)', async () => {
    // What the Cloudflare entry does: it passes no loader, so envelope
    // orchestration is not something this target can offer at all
    await silently(() =>
      expect(() =>
        createESignApp({
          ALLOW_INSECURE_DEV: 'true',
          ESIGN_PROVIDER: 'mock',
          DATABASE_URL: 'postgres://u@h/db',
        })
      ).toThrow(/without the envelope module/)
    );
  });

  it('refuses envelope orchestration on the edge runtime', () => {
    expect(() =>
      createESignApp(
        { ALLOW_INSECURE_DEV: 'true', ESIGN_PROVIDER: 'mock', DATABASE_URL: 'postgres://u@h/db' },
        { runtime: 'edge' }
      )
    ).toThrow(/cannot open a Postgres connection/);
  });
});

describe('the mint', () => {
  it('mints for an authenticated caller', async () => {
    const response = await post(testApp(), '/webform/instance', { prefill: {} }, mintHeaders);

    expect(response.status).toBe(200);
    expect(await asJson<{ url: string }>(response)).toMatchObject({
      url: expect.stringContaining('/signing/mock-webform/'),
    });
  });

  it('refuses an unauthenticated caller', async () => {
    const response = await post(testApp(), '/webform/instance', { prefill: {} });

    expect(response.status).toBe(401);
    expect(await asJson(response)).toEqual({ error: 'Unauthorized' });
  });

  it('verifies the session rather than trusting the token, when a secret is configured', async () => {
    const app = testApp({ ALLOW_INSECURE_DEV: undefined, SESSION_HS256_SECRET: 'a-secret' });

    const response = await post(app, '/webform/instance', { prefill: {} }, mintHeaders);
    expect(response.status).toBe(401);
  });
});

describe('locked terms', () => {
  const TERMS_URL = 'https://host.example.com/terms';

  it('mints the terms the host computed, not the values the client sent', async () => {
    const termsFetch = vi.fn(
      async () => new Response(JSON.stringify({ prefill: { total_usd: '1000.00' } }))
    );
    const app = testApp({ TERMS_URL }, { fetch: termsFetch });

    const response = await post(
      app,
      '/webform/instance',
      { prefill: { units: '10', total_usd: '1' } },
      mintHeaders
    );
    expect(response.status).toBe(200);

    // The instance's page shows what was actually minted
    const { url } = await asJson<{ url: string }>(response);
    const page = await (await get(app, new URL(url).pathname)).text();
    expect(page).toContain('name="total_usd" value="1000.00" readonly');
    expect(page).toContain('name="units" value="10" readonly');
  });

  it('answers 502 with the terms message when the callback fails', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const termsFetch = vi.fn(async () => new Response('nope', { status: 500 }));
    const app = testApp({ TERMS_URL }, { fetch: termsFetch });

    const response = await post(app, '/webform/instance', { prefill: {} }, mintHeaders);

    expect(response.status).toBe(502);
    expect(await asJson(response)).toEqual({ error: 'Could not compute the signing terms' });
    errors.mockRestore();
  });

  it('keeps the generic 502 for a provider failure', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    // No TERMS_URL, so nothing can be blamed on the callback: a provider
    // failure keeps the mint's own generic message
    const failing = testApp(
      {},
      {
        provider: {
          createWebFormInstance: async () => {
            throw new Error('boom');
          },
        } as never,
      }
    );

    const response = await post(failing, '/webform/instance', { prefill: {} }, mintHeaders);
    expect(response.status).toBe(502);
    expect(await asJson(response)).toEqual({ error: 'Could not create signing session' });
    errors.mockRestore();
  });
});

describe('CORS', () => {
  const CORS_ALLOWED_ORIGINS = 'https://app.example.com';

  it('answers the mint preflight for an allow-listed origin', async () => {
    const response = await options(testApp({ CORS_ALLOWED_ORIGINS }), '/webform/instance', {
      origin: 'https://app.example.com',
    });

    expect(response.status).toBe(204);
    expect(response.headers.get('access-control-allow-origin')).toBe('https://app.example.com');
    expect(response.headers.get('access-control-allow-methods')).toContain('POST');
  });

  it('answers the GraphQL preflight and marks the answer', async () => {
    const app = testFullApp({ CORS_ALLOWED_ORIGINS });

    const preflight = await options(app, '/graphql', { origin: 'https://app.example.com' });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get('access-control-allow-origin')).toBe('https://app.example.com');

    const query = await post(
      app,
      '/graphql',
      { query: '{ __typename }' },
      { origin: 'https://app.example.com' }
    );
    expect(query.headers.get('access-control-allow-origin')).toBe('https://app.example.com');
    await app.stop();
  });

  it('does not mark an answer for an origin outside the list', async () => {
    const response = await get(testApp({ CORS_ALLOWED_ORIGINS }), '/health', {
      origin: 'https://evil.example.com',
    });

    expect(response.headers.get('access-control-allow-origin')).toBeNull();
    expect(response.headers.get('vary')).toBe('origin');
  });

  it('varies on origin even when the caller sent none', async () => {
    const response = await get(testApp({ CORS_ALLOWED_ORIGINS }), '/health');
    expect(response.headers.get('vary')).toBe('origin');
  });

  it('allows any origin with a wildcard', async () => {
    const response = await get(testApp({ CORS_ALLOWED_ORIGINS: '*' }), '/health', {
      origin: 'https://anywhere.example.com',
    });
    expect(response.headers.get('access-control-allow-origin')).toBe('*');
  });

  it('marks nothing when no origins are configured', async () => {
    const response = await get(testApp(), '/health', { origin: 'https://app.example.com' });
    expect(response.headers.get('access-control-allow-origin')).toBeNull();
    expect(response.headers.get('vary')).toBeNull();
  });
});

describe('security headers', () => {
  it('sets the fail-closed baseline on JSON routes', async () => {
    const response = await get(testApp(), '/health');

    expect(response.headers.get('content-security-policy')).toBe(
      "default-src 'none';frame-ancestors 'none'"
    );
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('x-frame-options')).toBe('DENY');
    expect(response.headers.get('referrer-policy')).toBe('no-referrer');
    expect(response.headers.get('strict-transport-security')).toContain('max-age=');
  });

  it('leaves a signing page its own nonce-based policy', async () => {
    const response = await get(testApp(), '/signing/return?event=signing_complete');

    const csp = response.headers.get('content-security-policy') ?? '';
    expect(csp).toMatch(/script-src 'nonce-/);
    expect(csp).not.toContain("frame-ancestors 'none'");
    const nonce = csp.match(/script-src 'nonce-([^']+)'/)?.[1];
    expect(await response.text()).toContain(`nonce="${nonce}"`);
  });
});

describe('the mock provider pages', () => {
  it('serves the mock signing page', async () => {
    const response = await get(testApp(), '/signing/mock/abc-123');

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/html');
    expect(await response.text()).toContain('Envelope abc-123');
  });

  it('does not serve them for a real provider', async () => {
    const app = testApp({
      ESIGN_PROVIDER: 'docusign',
      DOCUSIGN_INTEGRATION_KEY: 'ik',
      DOCUSIGN_ACCOUNT_ID: 'acct',
      DOCUSIGN_USER_ID: 'user',
      DOCUSIGN_PRIVATE_KEY: 'pem',
      DOCUSIGN_WEBFORM_ID: 'form',
      DOCUSIGN_RETURN_URL: 'https://api.example.com/signing/return',
    });

    expect((await get(app, '/signing/mock/abc-123')).status).toBe(404);
  });

  it('can be switched off for the mock provider too', async () => {
    expect((await get(testApp({ MOCK_PAGES: 'false' }), '/signing/mock/abc-123')).status).toBe(404);
  });
});

describe('the envelope webhook', () => {
  const HMAC_KEY = 'test-integration-hmac-key';

  const signature = (body: string): string =>
    crypto.createHmac('sha256', HMAC_KEY).update(body, 'utf8').digest('base64');

  const payload = (envelopeId: string) =>
    JSON.stringify({
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
        envelopeSummary: { status: 'completed', emailSubject: 'Test Document' },
      },
    });

  // A persisted, still-being-signed envelope the webhook may complete
  const seedSentEnvelope = () =>
    store.createEnvelope({
      id: randomUUID(),
      providerEnvelopeId: `docusign-test-${randomUUID()}`,
      userId: 'user-456',
      contractType: 'loan_agreement',
      status: 'sent',
    });

  let app: ReturnType<typeof testFullApp>;
  let errors: ReturnType<typeof vi.spyOn>;
  let logs: ReturnType<typeof vi.spyOn>;
  let warns: ReturnType<typeof vi.spyOn>;

  beforeAll(() => {
    // The key belongs to the app's own environment: the adapter reads the
    // env the app was built with, not process.env
    app = testFullApp({ DOCUSIGN_HMAC_KEY: HMAC_KEY });
  });

  afterAll(async () => {
    await app.stop();
  });

  // The security-event logging on a bad signature, the "unknown envelope"
  // warning and the processed-webhook log are expected here. The service
  // composes the package on the console and has no seam of its own, so this
  // suite opts out of the silent-tests gate (vitest.setup.ts) by spying on
  // the console itself - per test, so the spy sits on top of the gate's,
  // never underneath it.
  beforeEach(() => {
    errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    logs = vi.spyOn(console, 'log').mockImplementation(() => {});
    warns = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    errors.mockRestore();
    logs.mockRestore();
    warns.mockRestore();
  });

  it('refuses an invalid signature', async () => {
    const response = await post(app, '/webhook/esign', payload('docusign-test-123'), {
      'x-docusign-signature-1': 'aW52YWxpZC1zaWduYXR1cmU=',
    });

    expect(response.status).toBe(401);
    expect(await asJson(response)).toEqual({ error: 'Unauthorized' });
  });

  it('refuses a missing signature', async () => {
    const response = await post(app, '/webhook/esign', payload('docusign-test-123'));

    expect(response.status).toBe(401);
  });

  it('does not touch the store when the signature is wrong', async () => {
    const seeded = await seedSentEnvelope();

    const response = await post(app, '/webhook/esign', payload(seeded.providerEnvelopeId), {
      'x-docusign-signature-1': 'aW52YWxpZA==',
    });

    expect(response.status).toBe(401);
    expect((await store.getEnvelopeById(seeded.id))?.status).toBe('sent');
    expect(await store.listAuditEntries(seeded.id)).toEqual([]);
  });

  it('acknowledges a signed event for an envelope it does not know', async () => {
    const body = payload(`unknown-${randomUUID()}`);

    const response = await post(app, '/webhook/esign', body, {
      'x-docusign-signature-1': signature(body),
    });

    expect(response.status).toBe(200);
    expect(await asJson(response)).toEqual({ received: true });
  });

  it('processes a signed event: status and audit trail', async () => {
    const seeded = await seedSentEnvelope();
    const body = payload(seeded.providerEnvelopeId);

    const response = await post(app, '/webhook/esign', body, {
      'x-docusign-signature-1': signature(body),
    });

    expect(response.status).toBe(200);
    expect((await store.getEnvelopeById(seeded.id))?.status).toBe('completed');
    const audit = await store.listAuditEntries(seeded.id);
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ action: 'completed', metadata: { source: 'webhook' } });
  });

  it('refuses an unparseable payload that carries a valid signature', async () => {
    const body = 'not valid json {{{';

    const response = await post(app, '/webhook/esign', body, {
      'x-docusign-signature-1': signature(body),
    });

    expect(response.status).toBe(400);
    expect(await asJson(response)).toEqual({ error: 'Invalid payload' });
  });

  it('logs the client a trusted proxy reports', async () => {
    const trusting = testFullApp({ DOCUSIGN_HMAC_KEY: HMAC_KEY, TRUST_PROXY: 'true' });
    const body = payload('docusign-test-123');

    const response = await post(trusting, '/webhook/esign', body, {
      'x-docusign-signature-1': 'aW52YWxpZA==',
      'x-forwarded-for': '203.0.113.7, 10.0.0.1',
    });

    expect(response.status).toBe(401);
    // The security log names the forwarded client, not the proxy
    expect(errors).toHaveBeenCalledWith(
      'Security event:',
      expect.stringContaining('"ip":"203.0.113.7"')
    );
    await trusting.stop();
  });

  it('ignores a forwarded client the deployment does not trust', async () => {
    // Without TRUST_PROXY the header is caller-controlled, so it must not
    // reach the audit trail as if it were the caller's address
    errors.mockClear();
    const body = payload('docusign-test-123');

    const response = await post(app, '/webhook/esign', body, {
      'x-docusign-signature-1': 'aW52YWxpZA==',
      'x-forwarded-for': '203.0.113.7',
    });

    expect(response.status).toBe(401);
    expect(errors).not.toHaveBeenCalledWith(
      'Security event:',
      expect.stringContaining('203.0.113.7')
    );
  });
});

describe('the GraphQL API', () => {
  const ENVELOPE_QUERY = {
    query: 'query GetEnvelope($id: String!) { envelope(id: $id) { id status } }',
    variables: { id: 'uuid-123' },
  };

  let app: ReturnType<typeof testFullApp>;

  beforeAll(() => {
    app = testFullApp();
  });

  afterAll(async () => {
    await app.stop();
  });

  it('is unauthenticated without an Authorization header', async () => {
    const response = await post(app, '/graphql', ENVELOPE_QUERY);

    expect(response.status).toBe(200);
    const body = await asJson<{ errors: { extensions: { code: string } }[] }>(response);
    expect(body.errors[0].extensions.code).toBe('UNAUTHORIZED');
  });

  it('takes the caller from the verified session', async () => {
    const response = await post(app, '/graphql', ENVELOPE_QUERY, {
      authorization: 'Bearer test-user-123',
    });

    const body = await asJson<{ errors: { extensions: { code: string } }[] }>(response);
    // Authenticated, so past UNAUTHORIZED: no such envelope is stored
    expect(body.errors[0].extensions.code).toBe('ENVELOPE_NOT_FOUND');
  });

  it('resolves a stored envelope for its owner', async () => {
    const seeded = await store.createEnvelope({
      id: randomUUID(),
      providerEnvelopeId: `docusign-${randomUUID()}`,
      userId: 'test-user-123',
      contractType: 'loan_agreement',
      status: 'sent',
    });

    const response = await post(
      app,
      '/graphql',
      { ...ENVELOPE_QUERY, variables: { id: seeded.id } },
      { authorization: 'Bearer test-user-123' }
    );

    const body = await asJson<{ data: { envelope: unknown }; errors?: unknown }>(response);
    expect(body.errors).toBeUndefined();
    expect(body.data.envelope).toEqual({ id: seeded.id, status: 'sent' });
  });

  it('answers 400 for a body that is not a GraphQL request', async () => {
    const response = await post(app, '/graphql', 'not json at all');
    expect(response.status).toBe(400);
  });

  it('serves the dev landing page on GET', async () => {
    const response = await get(app, '/graphql', { accept: 'text/html' });

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/html');
  });

  it('allows introspection outside production', async () => {
    const response = await post(app, '/graphql', {
      query: '{ __schema { queryType { name } } }',
    });

    expect(await asJson<{ errors?: unknown }>(response)).not.toHaveProperty('errors');
  });

  it('disables introspection when ESIGN_ENV=production', async () => {
    const production = testFullApp({
      ESIGN_ENV: 'production',
      ESIGN_ALLOW_DEMO: 'true',
      ESIGN_ALLOW_CLIENT_PREFILL: 'true',
    });

    const response = await post(production, '/graphql', {
      query: '{ __schema { queryType { name } } }',
    });

    expect(await asJson<{ errors?: unknown }>(response)).toHaveProperty('errors');
    await production.stop();
  });

  it('surfaces a failure to build the capability on the first request that needs it', async () => {
    const failing = testFullApp(
      {},
      {
        loadEnvelopes: async () => {
          throw new Error('no database');
        },
      }
    );

    await expect(post(failing, '/graphql', ENVELOPE_QUERY)).rejects.toThrow('no database');
    await expect(failing.stop()).rejects.toThrow('no database');
  });
});
