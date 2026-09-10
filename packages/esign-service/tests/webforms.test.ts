// Web Forms instance capability: mock provider, DocuSign provider (mocked
// fetch), the /webform/instance route, and the mock-webform page.

import { generateKeyPairSync } from 'crypto';
import { vi } from 'vitest';

vi.mock('../src/envelope');
vi.mock('../src/audit');
vi.mock('../src/db', () => ({
  DATABASE_URL: 'DATABASE_URL',
  createKnexClient: () => ({ transaction: (cb: (trx: unknown) => unknown) => cb({}) }),
}));

import { LOCKED_FIELDS_HINT } from '@blinkbitcoin/esign-node';
import { selectProvider } from '../src/providers';
import { createProvider } from '../src/providers/docusign';
import { createMock } from '../src/providers/mock';
import { supportsHostedForms, supportsWebForms } from '../src/providers/port';
import { asJson, get, post, testApp } from './support/app';

// One adapter of each for this file: the service builds a fresh set per
// app, so a test builds its own. The app under test is driven with the very
// selection below, so a spy on `provider` is the adapter it mints through.
const DocuSignProvider = createProvider();
const clearTokenCache = (): void => DocuSignProvider.reset();
const MockProvider = createMock();
const { clearEnvelopes, getWebFormPrefill } = MockProvider;
const selection = selectProvider({ ESIGN_PROVIDER: 'mock' });
const provider = selection.provider;

const { privateKey: testPrivateKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
});

describe('supportsHostedForms', () => {
  it('is true for the mock and DocuSign providers', () => {
    expect(supportsHostedForms(MockProvider)).toBe(true);
    expect(supportsHostedForms(DocuSignProvider)).toBe(true);
    // the deprecated alias answers the same
    expect(supportsWebForms(MockProvider)).toBe(true);
  });

  it('is false for a provider without the method (under either port name)', () => {
    const minimal = { ...MockProvider };
    delete (minimal as { createWebFormInstance?: unknown }).createWebFormInstance;
    delete (minimal as { createHostedFormInstance?: unknown }).createHostedFormInstance;
    expect(supportsHostedForms(minimal)).toBe(false);
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
        returnUrl: 'http://localhost:4100/signing/return',
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
  // A fresh app per call: the package binds the provider's mint once, at
  // construction, so a spy installed by a test has to be in place first
  const mint = (body?: unknown, headers: HeadersInit = { authorization: 'Bearer user-1' }) =>
    post(testApp({}, selection), '/webform/instance', body, headers);

  it('mints an instance for an authenticated caller', async () => {
    const response = await mint({ prefill: { full_name: 'Jane', email: 'jane@example.com' } });

    expect(response.status).toBe(200);
    expect((await asJson<{ url: string }>(response)).url).toMatch(/\/signing\/mock-webform\//);
  });

  it('accepts a request with no prefill body', async () => {
    expect((await mint()).status).toBe(200);
  });

  it('forwards typed prefill (numbers unquoted) to the provider', async () => {
    const spy = vi.spyOn(provider, 'createWebFormInstance');
    const prefill = { full_name: 'Jane', units: 1000, settlement_btc: 0.01268231 };

    const response = await mint({ prefill });

    expect(response.status).toBe(200);
    expect(spy).toHaveBeenCalledWith('user-1', prefill);
    spy.mockRestore();
  });

  it('rejects a malformed prefill with 400 and a reason, before touching the provider', async () => {
    const spy = vi.spyOn(provider, 'createWebFormInstance');

    const response = await mint({ prefill: { units: true } });

    expect(response.status).toBe(400);
    expect(await asJson(response)).toEqual({
      error: 'Invalid prefill: unsupported value for field "units"',
    });
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('rejects an unauthenticated caller with 401', async () => {
    expect((await mint({ prefill: {} }, {})).status).toBe(401);
  });

  it('returns 502 when the provider fails to mint an instance', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const spy = vi
      .spyOn(provider, 'createWebFormInstance')
      .mockRejectedValueOnce({ extensions: { code: 'PROVIDER_UNAVAILABLE' } });

    expect((await mint({ prefill: {} })).status).toBe(502);

    spy.mockRestore();
    errorSpy.mockRestore();
  });

  it('returns 502 for a plain (non-coded) provider error', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const spy = vi
      .spyOn(provider, 'createWebFormInstance')
      .mockRejectedValueOnce(new Error('boom'));

    expect((await mint({ prefill: {} })).status).toBe(502);

    spy.mockRestore();
    errorSpy.mockRestore();
  });

  it('returns 400 when the provider does not support Web Forms', async () => {
    // A provider without the optional capability: the mint answers 400
    // rather than pretending it minted something
    const { createWebFormInstance: _unsupported, ...withoutWebForms } = provider;
    const unsupported = testApp({}, { ...selection, provider: withoutWebForms });

    const response = await post(
      unsupported,
      '/webform/instance',
      { prefill: {} },
      { authorization: 'Bearer user-1' }
    );

    expect(response.status).toBe(400);
  });
});

describe('GET /signing/mock-webform/:id', () => {
  const app = testApp({}, selection);

  it('serves the mock web-form page with a nonce CSP', async () => {
    const response = await get(app, '/signing/mock-webform/abc-123');
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get('content-security-policy')).toMatch(/script-src 'nonce-/);
    expect(html).toContain('Instance abc-123');
    expect(html).toContain('data-event="signingResult"');
    expect(html).not.toContain('<form');
  });

  it('shows the prefill a minted instance carries as locked fields', async () => {
    const minted = await post(
      app,
      '/webform/instance',
      { prefill: { units: 1000, total_usd: 1000.5 } },
      { authorization: 'Bearer user-1' }
    );
    const { pathname } = new URL((await asJson<{ url: string }>(minted)).url);

    const response = await get(app, pathname);
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(html).toContain('name="units" value="1000" readonly');
    expect(html).toContain('name="total_usd" value="1000.5" readonly');
    expect(html).toContain(LOCKED_FIELDS_HINT);
  });

  it('shows query-string prefill (public-form URL style) as editable fields', async () => {
    const response = await get(app, '/signing/mock-webform/public-demo?full_name=Test+User');
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(html).toContain('name="full_name" value="Test User" />');
    expect(html).not.toContain('data-locked');
    expect(html).not.toContain(LOCKED_FIELDS_HINT);
  });
});
