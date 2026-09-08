import { createDocuSignClient } from '../client';
import { DocuSignConfigError } from '../config';
import { HttpError } from '../http';
import { WebFormPrefillError } from '../prefill';
import { clientFor, createWebFormInstance } from '../webforms';
import { fail, fakeFetch, ok, testConfig, token } from './support';

const instance = () =>
  ok({ formUrl: 'https://f', instanceToken: 'T', id: 'i-1' });

describe('createWebFormInstance', () => {
  it('validates the prefill, mints with the config returnUrl and retries transient failures', async () => {
    const { fetchImpl, calls, body } = fakeFetch([
      token(),
      fail(503, 'busy'),
      instance(),
    ]);
    const client = createDocuSignClient(testConfig(), { fetch: fetchImpl });

    const result = await createWebFormInstance({
      client,
      userId: 'user-1',
      prefill: { number_of_units: 1000, reference: 'E2E-0001' },
      retry: { maxAttempts: 2, baseDelay: 1 },
    });

    expect(result).toEqual({
      url: 'https://f#instanceToken=T',
      instanceId: 'i-1',
    });
    expect(calls).toHaveLength(3);
    expect(body(2)).toEqual({
      clientUserId: 'user-1',
      formValues: { number_of_units: 1000, reference: 'E2E-0001' },
      returnUrl: 'https://api.example.com/signing/return',
    });
  });

  it('lets the call override returnUrl and set the expiration', async () => {
    const { fetchImpl, body } = fakeFetch([token(), instance()]);
    const client = createDocuSignClient(testConfig(), { fetch: fetchImpl });
    await createWebFormInstance({
      client,
      userId: 'u',
      prefill: {},
      returnUrl: 'https://app.example.com/done',
      expirationOffsetHours: 48,
    });
    expect(body(1)).toEqual({
      clientUserId: 'u',
      formValues: {},
      returnUrl: 'https://app.example.com/done',
      expirationOffset: 48,
    });
  });

  it('treats a missing prefill as empty and truncates clientUserId to 100 chars', async () => {
    const { fetchImpl, body } = fakeFetch([token(), instance()]);
    const client = createDocuSignClient(testConfig({ returnUrl: undefined }), {
      fetch: fetchImpl,
    });
    await createWebFormInstance({ client, userId: 'x'.repeat(150) });
    expect(body(1)).toEqual({ clientUserId: 'x'.repeat(100), formValues: {} });
  });

  it('rejects a bad prefill before any network call', async () => {
    const { fetchImpl, calls } = fakeFetch([]);
    const client = createDocuSignClient(testConfig(), { fetch: fetchImpl });
    await expect(
      createWebFormInstance({ client, userId: 'u', prefill: { units: true } }),
    ).rejects.toEqual(
      new WebFormPrefillError('unsupported value for field "units"'),
    );
    expect(calls).toHaveLength(0);
  });

  it('fails fast without a form id, before any network call', async () => {
    const { fetchImpl, calls } = fakeFetch([]);
    const client = createDocuSignClient(testConfig({ webFormId: undefined }), {
      fetch: fetchImpl,
    });
    await expect(
      createWebFormInstance({ client, userId: 'u', prefill: {} }),
    ).rejects.toThrow(DocuSignConfigError);
    expect(calls).toHaveLength(0);
  });

  it('gives up on a client error without retrying', async () => {
    const { fetchImpl, calls } = fakeFetch([
      token(),
      fail(400, 'well formed but otherwise invalid'),
    ]);
    const client = createDocuSignClient(testConfig(), { fetch: fetchImpl });
    await expect(
      createWebFormInstance({ client, userId: 'u', prefill: {} }),
    ).rejects.toEqual(new HttpError(400, 'well formed but otherwise invalid'));
    expect(calls).toHaveLength(2);
  });

  it('accepts a config instead of a client, caching one client per config object', async () => {
    const original = globalThis.fetch;
    const { fetchImpl, calls } = fakeFetch([token(), instance(), instance()]);
    globalThis.fetch = fetchImpl as unknown as typeof fetch;
    const config = testConfig();

    await createWebFormInstance({ config, userId: 'u', prefill: {} });
    await createWebFormInstance({ config, userId: 'u', prefill: {} });
    expect(
      calls.filter(call => call.url.endsWith('/oauth/token')),
    ).toHaveLength(1);
    expect(clientFor(config)).toBe(clientFor(config));
    expect(clientFor(testConfig())).not.toBe(clientFor(config));

    globalThis.fetch = original;
  });

  it('needs a client or a config', async () => {
    await expect(
      createWebFormInstance({ userId: 'u', prefill: {} }),
    ).rejects.toThrow('needs a `client` or a `config`');
  });
});
