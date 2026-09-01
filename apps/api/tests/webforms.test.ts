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

import type { Express } from 'express';
import { createApp } from '../src/app';
import { provider } from '../src/providers';
import { clearTokenCache, DocuSignProvider } from '../src/providers/docusign';
import { MockProvider } from '../src/providers/mock';
import { supportsWebForms } from '../src/providers/port';
import { renderMockWebFormPage } from '../src/signingPages';

const { privateKey: testPrivateKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
});

describe('supportsWebForms', () => {
  it('is true for the mock and DocuSign providers', () => {
    expect(supportsWebForms(MockProvider)).toBe(true);
    expect(supportsWebForms(DocuSignProvider)).toBe(true);
  });

  it('is false for a provider without the method', () => {
    const minimal = { ...MockProvider };
    delete (minimal as { createWebFormInstance?: unknown }).createWebFormInstance;
    expect(supportsWebForms(minimal)).toBe(false);
  });
});

describe('MockProvider.createWebFormInstance', () => {
  it('returns a mock-webform URL + instanceId', async () => {
    const result = await MockProvider.createWebFormInstance!('user-1', { full_name: 'Jane' });
    expect(result.url).toMatch(/\/signing\/mock-webform\/[0-9a-f-]{36}$/);
    expect(result.instanceId).toMatch(/[0-9a-f-]{36}/);
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

    const result = await DocuSignProvider.createWebFormInstance!('user-42', { full_name: 'Jane' });
    expect(result).toEqual({
      url: 'https://wf.test/f/abc#instanceToken=TKN',
      instanceId: 'inst-9',
    });
    // The createInstance body includes the required clientUserId + formValues
    const instanceCall = mockFetch.mock.calls[1];
    expect(JSON.parse(instanceCall[1].body)).toEqual({
      clientUserId: 'user-42',
      formValues: { full_name: 'Jane' },
    });
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

describe('renderMockWebFormPage', () => {
  it('emits the real DocuSign sessionEnd vocabulary via both hosts', () => {
    const html = renderMockWebFormPage('inst-1');
    // Real DocuSign.js sessionEnd discriminators
    expect(html).toContain('data-event="signingResult"');
    expect(html).toContain('data-event="cancel"');
    expect(html).toContain('data-event="decline"');
    expect(html).toContain('data-event="sessionTimeout"');
    // Posts the sessionEnd envelope shape, not a bare type
    expect(html).toContain("event: 'sessionEnd'");
    expect(html).toContain('window.ReactNativeWebView.postMessage');
    expect(html).toContain('window.parent.postMessage');
    expect(html).toContain('Instance inst-1');
  });

  it('sanitizes the instance id', () => {
    expect(renderMockWebFormPage('<img onerror=alert(1)>')).toContain('Instance unknown');
  });
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
  });
});
