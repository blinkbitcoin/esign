// Web Forms instance capability: mock provider, DocuSign provider (mocked
// fetch), the /webform/instance route, and the mock-webform page.

import { generateKeyPairSync } from 'crypto';
import request from 'supertest';
import { vi } from 'vitest';

vi.mock('../src/envelope');
vi.mock('../src/audit');
vi.mock('../src/db', () => ({
  knex: { transaction: (cb: (trx: unknown) => unknown) => cb({}) },
}));

import { LOCKED_FIELDS_HINT } from '@blinkbitcoin/esign-server';
import type { Express } from 'express';
import { createApp } from '../src/app';
import { provider } from '../src/providers';
import { clearTokenCache, DocuSignProvider } from '../src/providers/docusign';
import { clearEnvelopes, getWebFormPrefill, MockProvider } from '../src/providers/mock';
import { supportsWebForms } from '../src/providers/port';

const { privateKey: testPrivateKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
});

describe('supportsWebForms', () => {
  it('is true for the mock and DocuSign providers', () => {
    expect(supportsWebForms(MockProvider)).toBe(true);
    expect(supportsWebForms(DocuSignProvider)).toBe(true);
  });

  it('is false for a provider without the method (under either port name)', () => {
    const minimal = { ...MockProvider };
    delete (minimal as { createWebFormInstance?: unknown }).createWebFormInstance;
    delete (minimal as { createHostedFormInstance?: unknown }).createHostedFormInstance;
    expect(supportsWebForms(minimal)).toBe(false);
  });
});

describe('MockProvider.createWebFormInstance', () => {
  beforeEach(() => {
    clearEnvelopes();
  });

  it('returns a mock-webform URL + instanceId', async () => {
    const result = await MockProvider.createWebFormInstance!('user-1', { full_name: 'Jane' });
    expect(result.url).toMatch(/\/signing\/mock-webform\/[0-9a-f-]{36}$/);
    expect(result.instanceId).toMatch(/[0-9a-f-]{36}/);
  });

  it('keeps the prefill with the instance, like DocuSign stores formValues', async () => {
    const prefill = { full_name: 'Jane', units: 1000, alerts: ['a', 'b'] };
    const result = await MockProvider.createWebFormInstance!('user-1', prefill);
    expect(getWebFormPrefill(result.instanceId!)).toEqual(prefill);
  });

  it('has no prefill for an unknown instance, and forgets instances on clear', async () => {
    expect(getWebFormPrefill('public-demo')).toBeUndefined();
    const result = await MockProvider.createWebFormInstance!('user-1', { a: 'b' });
    clearEnvelopes();
    expect(getWebFormPrefill(result.instanceId!)).toBeUndefined();
  });
});

describe('DocuSignProvider.createWebFormInstance', () => {
  const originalFetch = global.fetch;
  const mockFetch = vi.fn();
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    global.fetch = mockFetch as unknown as typeof fetch;
    mockFetch.mockClear();
    clearTokenCache();
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    process.env.DOCUSIGN_INTEGRATION_KEY = 'key';
    process.env.DOCUSIGN_USER_ID = 'usr';
    process.env.DOCUSIGN_ACCOUNT_ID = 'acct';
    process.env.DOCUSIGN_PRIVATE_KEY = testPrivateKey;
    process.env.DOCUSIGN_WEBFORM_ID = 'form-1';
    process.env.DOCUSIGN_WEBFORMS_BASE_URL = 'https://wf.test';
  });

  afterEach(() => {
    global.fetch = originalFetch;
    consoleErrorSpy.mockRestore();
    delete process.env.DOCUSIGN_INTEGRATION_KEY;
    delete process.env.DOCUSIGN_USER_ID;
    delete process.env.DOCUSIGN_ACCOUNT_ID;
    delete process.env.DOCUSIGN_PRIVATE_KEY;
    delete process.env.DOCUSIGN_WEBFORM_ID;
    delete process.env.DOCUSIGN_WEBFORMS_BASE_URL;
  });

  it('throws a validation error when the form id is not configured', async () => {
    delete process.env.DOCUSIGN_WEBFORM_ID;
    await expect(DocuSignProvider.createWebFormInstance!('u', {})).rejects.toMatchObject({
      extensions: { code: 'VALIDATION_ERROR' },
    });
  });

  it('creates an instance and builds the fragment URL', async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ access_token: 'tok', expires_in: 3600 }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({ formUrl: 'https://wf.test/f/abc', instanceToken: 'TKN', id: 'inst-9' }),
      });

    // Every documented formValues shape, forwarded verbatim: numbers stay
    // unquoted (DocuSign Number fields reject quoted numbers)
    const prefill = {
      full_name: 'Jane',
      units: 1000,
      settlement_btc: 0.01268231,
      alerts: ['Funds_withdrawn'],
      phone_num: { countryCode: '55', nationalNumber: '1133301000' },
    };
    const result = await DocuSignProvider.createWebFormInstance!('user-42', prefill);
    expect(result).toEqual({
      url: 'https://wf.test/f/abc#instanceToken=TKN',
      instanceId: 'inst-9',
    });
    // The createInstance body includes the required clientUserId + formValues
    const instanceCall = mockFetch.mock.calls[1];
    // ... plus the service's return-URL bridge, so a plain WebView/iframe
    // host gets the signing outcome without DocuSign.js
    expect(instanceCall[1].body).toBe(
      JSON.stringify({
        clientUserId: 'user-42',
        formValues: prefill,
        returnUrl: 'http://localhost:4000/signing/return',
      })
    );
    expect(instanceCall[1].body).toContain('"units":1000,');
  });

  it('maps a 4xx from the Web Forms API to envelope-creation-failed', async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ access_token: 'tok', expires_in: 3600 }),
      })
      .mockResolvedValueOnce({ ok: false, status: 400, text: () => Promise.resolve('bad form') });

    await expect(DocuSignProvider.createWebFormInstance!('u', {})).rejects.toMatchObject({
      extensions: { code: 'ENVELOPE_CREATION_FAILED' },
    });
  });

  it('maps a network failure (after retries) to provider-unavailable', async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ access_token: 'tok', expires_in: 3600 }),
      })
      .mockRejectedValue(new Error('network down')); // retried, then surfaced

    await expect(DocuSignProvider.createWebFormInstance!('u', {})).rejects.toMatchObject({
      extensions: { code: 'PROVIDER_UNAVAILABLE' },
    });
  }, 15000);
});

describe('POST /webform/instance', () => {
  let app: Express;
  beforeAll(async () => {
    app = await createApp();
  });

  it('mints an instance for an authenticated caller', async () => {
    const response = await request(app)
      .post('/webform/instance')
      .set('authorization', 'Bearer user-1')
      .send({ prefill: { full_name: 'Jane', email: 'jane@example.com' } });

    expect(response.status).toBe(200);
    expect(response.body.url).toMatch(/\/signing\/mock-webform\//);
  });

  it('accepts a request with no prefill body', async () => {
    const response = await request(app)
      .post('/webform/instance')
      .set('authorization', 'Bearer user-1')
      .send();
    expect(response.status).toBe(200);
  });

  it('forwards typed prefill (numbers unquoted) to the provider', async () => {
    const spy = vi.spyOn(provider, 'createWebFormInstance');
    const prefill = { full_name: 'Jane', units: 1000, settlement_btc: 0.01268231 };
    const response = await request(app)
      .post('/webform/instance')
      .set('authorization', 'Bearer user-1')
      .send({ prefill });

    expect(response.status).toBe(200);
    expect(spy).toHaveBeenCalledWith('user-1', prefill);
    spy.mockRestore();
  });

  it('rejects a malformed prefill with 400 and a reason, before touching the provider', async () => {
    const spy = vi.spyOn(provider, 'createWebFormInstance');
    const response = await request(app)
      .post('/webform/instance')
      .set('authorization', 'Bearer user-1')
      .send({ prefill: { units: true } });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      error: 'Invalid prefill: unsupported value for field "units"',
    });
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('rejects an unauthenticated caller with 401', async () => {
    const response = await request(app).post('/webform/instance').send({ prefill: {} });
    expect(response.status).toBe(401);
  });

  it('returns 502 when the provider fails to mint an instance', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const spy = vi
      .spyOn(provider, 'createWebFormInstance')
      .mockRejectedValueOnce({ extensions: { code: 'PROVIDER_UNAVAILABLE' } });

    const response = await request(app)
      .post('/webform/instance')
      .set('authorization', 'Bearer user-1')
      .send({ prefill: {} });

    expect(response.status).toBe(502);
    spy.mockRestore();
    errorSpy.mockRestore();
  });

  it('returns 502 for a plain (non-coded) provider error', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const spy = vi
      .spyOn(provider, 'createWebFormInstance')
      .mockRejectedValueOnce(new Error('boom'));

    const response = await request(app)
      .post('/webform/instance')
      .set('authorization', 'Bearer user-1')
      .send({ prefill: {} });

    expect(response.status).toBe(502);
    spy.mockRestore();
    errorSpy.mockRestore();
  });

  it('returns 400 when the provider does not support Web Forms', async () => {
    // Temporarily strip the capability from the singleton
    const original = provider.createWebFormInstance;
    delete (provider as { createWebFormInstance?: unknown }).createWebFormInstance;

    const response = await request(app)
      .post('/webform/instance')
      .set('authorization', 'Bearer user-1')
      .send({ prefill: {} });

    expect(response.status).toBe(400);
    provider.createWebFormInstance = original;
  });
});

describe('GET /signing/mock-webform/:id', () => {
  let app: Express;
  beforeAll(async () => {
    app = await createApp();
  });

  it('serves the mock web-form page with a nonce CSP', async () => {
    const response = await request(app).get('/signing/mock-webform/abc-123');
    expect(response.status).toBe(200);
    expect(response.headers['content-security-policy']).toMatch(/script-src 'nonce-/);
    expect(response.text).toContain('Instance abc-123');
    expect(response.text).toContain('data-event="signingResult"');
    expect(response.text).not.toContain('<form');
  });

  it('shows the prefill a minted instance carries as locked fields', async () => {
    const minted = await request(app)
      .post('/webform/instance')
      .set('authorization', 'Bearer user-1')
      .send({ prefill: { units: 1000, total_usd: 1000.5 } });
    const path = new URL(minted.body.url).pathname;

    const response = await request(app).get(path);
    expect(response.status).toBe(200);
    expect(response.text).toContain('name="units" value="1000" readonly');
    expect(response.text).toContain('name="total_usd" value="1000.5" readonly');
    expect(response.text).toContain(LOCKED_FIELDS_HINT);
  });

  it('shows query-string prefill (public-form URL style) as editable fields', async () => {
    const response = await request(app).get(
      '/signing/mock-webform/public-demo?full_name=Test+User'
    );
    expect(response.status).toBe(200);
    expect(response.text).toContain('name="full_name" value="Test User" />');
    expect(response.text).not.toContain('data-locked');
    expect(response.text).not.toContain(LOCKED_FIELDS_HINT);
  });
});
