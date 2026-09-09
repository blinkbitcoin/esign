// The framework-neutral handlers: Fetch API Request → Response, the shape a
// serverless / route handler mounts directly. The decision logic they share
// with the Express router is exercised through them.

import { createDocuSignClient } from '../docusign/client';
import { createEnvelopeService } from '../envelopes';
import {
  createHostedFormInstanceHandler,
  createWebFormInstanceHandler,
  createWebhookHandler,
  mintWebFormInstanceHttp,
  processWebhookHttp,
} from '../handlers';
import type { ESignProvider } from '../provider';
import { createMemoryEnvelopeStore } from '../store';
import { fakeFetch, ok, testConfig, token } from './support';

const silent = { log: jest.fn(), warn: jest.fn(), error: jest.fn() };

const post = (
  url: string,
  body?: string,
  headers: Record<string, string> = {},
) => new Request(url, { method: 'POST', body, headers });

const provider = (overrides: Partial<ESignProvider> = {}): ESignProvider => ({
  createEnvelope: jest.fn(),
  getEnvelopeStatus: jest.fn(),
  getSigningUrl: jest.fn(),
  verifyWebhook: jest.fn().mockReturnValue(true),
  parseWebhookEvent: jest.fn().mockImplementation((raw: string) =>
    raw.startsWith('{')
      ? {
          providerEnvelopeId: JSON.parse(raw).envelopeId,
          rawStatus: 'completed',
          status: 'completed',
        }
      : null,
  ),
  createWebFormInstance: jest
    .fn()
    .mockResolvedValue({ url: 'https://f#instanceToken=T', instanceId: 'i-1' }),
  ...overrides,
});

describe('createWebFormInstanceHandler', () => {
  it('mints for an authenticated caller through a provider', async () => {
    const p = provider();
    const handler = createWebFormInstanceHandler({
      provider: p,
      authenticate: request =>
        request.headers.get('authorization') === 'Bearer jwt' ? 'user-1' : null,
      logger: silent,
    });
    const response = await handler(
      post(
        'https://api.example.com/webform/instance',
        JSON.stringify({ prefill: { units: 10 } }),
        {
          authorization: 'Bearer jwt',
          'content-type': 'application/json',
        },
      ),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/json');
    expect(await response.json()).toEqual({
      url: 'https://f#instanceToken=T',
      instanceId: 'i-1',
    });
    expect(p.createWebFormInstance).toHaveBeenCalledWith('user-1', {
      units: 10,
    });
  });

  it('mints straight from a DocuSign config (the serverless way), with the config returnUrl', async () => {
    const { fetchImpl, body } = fakeFetch([
      token(),
      ok({ formUrl: 'https://f', instanceToken: 'T', id: 'i-9' }),
    ]);
    const client = createDocuSignClient(testConfig(), { fetch: fetchImpl });
    const handler = createWebFormInstanceHandler({
      client,
      authenticate: async () => 'user-2',
    });
    const response = await handler(
      post(
        'https://x/mint',
        JSON.stringify({ prefill: { reference: 'E2E-1' } }),
      ),
    );
    expect(await response.json()).toEqual({
      url: 'https://f#instanceToken=T',
      instanceId: 'i-9',
    });
    expect(body(1)).toEqual({
      clientUserId: 'user-2',
      formValues: { reference: 'E2E-1' },
      returnUrl: 'https://api.example.com/signing/return',
    });
  });

  it('answers 401 without a user, 400 for a bad or unparseable body, 400 without Web Forms support', async () => {
    const withProvider = createWebFormInstanceHandler({
      provider: provider(),
      authenticate: () => null,
    });
    expect((await withProvider(post('https://x/mint'))).status).toBe(401);

    const authed = createWebFormInstanceHandler({
      provider: provider(),
      authenticate: () => 'u',
      logger: silent,
    });
    const bad = await authed(
      post('https://x/mint', JSON.stringify({ prefill: { units: true } })),
    );
    expect(bad.status).toBe(400);
    expect(await bad.json()).toEqual({
      error: 'Invalid prefill: unsupported value for field "units"',
    });
    // A body that is not JSON is refused as such
    const garbage = await authed(post('https://x/mint', 'not json'));
    expect(garbage.status).toBe(400);
    expect(await garbage.json()).toEqual({ error: 'Invalid JSON body' });
    // An empty body mints with an empty prefill
    expect((await authed(post('https://x/mint'))).status).toBe(200);

    const noWebForms = provider();
    delete (noWebForms as { createWebFormInstance?: unknown })
      .createWebFormInstance;
    const unsupported = createWebFormInstanceHandler({
      provider: noWebForms,
      authenticate: () => 'u',
    });
    const response = await unsupported(post('https://x/mint'));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: 'Web Forms not supported by the configured provider',
    });
  });

  it('answers 502 when minting fails and logs only the error code', async () => {
    const failing = provider({
      createWebFormInstance: jest
        .fn()
        .mockRejectedValue({ extensions: { code: 'PROVIDER_UNAVAILABLE' } }),
    });
    const handler = createWebFormInstanceHandler({
      provider: failing,
      authenticate: () => 'u',
      logger: silent,
    });
    const response = await handler(post('https://x/mint'));
    expect(response.status).toBe(502);
    expect(silent.error).toHaveBeenCalledWith(
      'Web Forms instance creation failed:',
      'PROVIDER_UNAVAILABLE',
    );
  });
});

describe('createHostedFormInstanceHandler', () => {
  it('mints through a mint function, with the prefill validation the host injects', async () => {
    const mint = jest.fn().mockResolvedValue({ url: 'https://h/1' });
    const parsePrefill = jest.fn((input: unknown) =>
      input && typeof input === 'object' && 'ok' in input
        ? { ok: true as const, prefill: input as Record<string, unknown> }
        : { ok: false as const, error: 'nope' },
    );
    const handler = createHostedFormInstanceHandler({
      mint,
      parsePrefill,
      authenticate: () => 'u',
    });
    // A value DocuSign's contract would refuse passes the host's parser
    const accepted = await handler(
      post('https://x/mint', JSON.stringify({ prefill: { ok: true } })),
    );
    expect(accepted.status).toBe(200);
    expect(mint).toHaveBeenCalledWith('u', { ok: true });
    const refused = await handler(
      post('https://x/mint', JSON.stringify({ prefill: { units: 1 } })),
    );
    expect(refused.status).toBe(400);
    expect(await refused.json()).toEqual({ error: 'Invalid prefill: nope' });
  });

  it('answers 400 for a mint target without a mint (a provider without the capability)', async () => {
    const handler = createHostedFormInstanceHandler({
      mint: undefined,
      authenticate: () => 'u',
    });
    expect((await handler(post('https://x/mint'))).status).toBe(400);
  });

  it('keeps DocuSign prefill validation by default, also through createWebFormInstanceHandler with a mint', async () => {
    const mint = jest.fn().mockResolvedValue({ url: 'https://h/1' });
    for (const handler of [
      createHostedFormInstanceHandler({ mint, authenticate: () => 'u' }),
      createWebFormInstanceHandler({ mint, authenticate: () => 'u' }),
    ]) {
      const bad = await handler(
        post('https://x/mint', JSON.stringify({ prefill: { units: true } })),
      );
      expect(bad.status).toBe(400);
      expect(await bad.json()).toEqual({
        error: 'Invalid prefill: unsupported value for field "units"',
      });
    }
    expect(mint).not.toHaveBeenCalled();
  });
});

describe('createWebhookHandler', () => {
  const setup = () => {
    const store = createMemoryEnvelopeStore();
    const p = provider();
    const envelopes = createEnvelopeService({
      provider: p,
      store,
      logger: silent,
    });
    return { store, p, envelopes };
  };

  it('passes headers, the raw body and the client ip to the provider and applies the event', async () => {
    const { store, p, envelopes } = setup();
    await store.createEnvelope({
      id: 'e',
      providerEnvelopeId: 'ds-1',
      userId: 'u',
      contractType: 'c',
      status: 'sent',
    });
    const handler = createWebhookHandler({
      provider: p,
      envelopes,
      clientIp: request => request.headers.get('x-forwarded-for') ?? undefined,
      logger: silent,
    });
    const raw = '{"envelopeId":"ds-1"}';
    const response = await handler(
      post('https://x/webhook', raw, {
        'x-docusign-signature-1': 'sig',
        'x-forwarded-for': '10.0.0.9',
      }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ received: true });
    expect(p.verifyWebhook).toHaveBeenCalledWith(
      expect.objectContaining({ 'x-docusign-signature-1': 'sig' }),
      raw,
      '10.0.0.9',
    );
    expect((await store.getEnvelopeById('e'))?.status).toBe('completed');
  });

  it('answers 401, 400 and 500 on the failure paths (no clientIp → undefined ip)', async () => {
    const { store, envelopes } = setup();
    const rejecting = createWebhookHandler({
      provider: provider({ verifyWebhook: jest.fn().mockReturnValue(false) }),
      envelopes,
    });
    expect((await rejecting(post('https://x/webhook', '{}'))).status).toBe(401);

    const p = provider();
    const handler = createWebhookHandler({
      provider: p,
      envelopes,
      logger: silent,
    });
    expect((await handler(post('https://x/webhook', 'nope'))).status).toBe(400);
    expect(p.verifyWebhook).toHaveBeenLastCalledWith(
      expect.anything(),
      'nope',
      undefined,
    );

    jest
      .spyOn(store, 'getEnvelopeByProviderEnvelopeId')
      .mockRejectedValueOnce(new Error('db down'));
    const failed = await handler(
      post('https://x/webhook', '{"envelopeId":"ds-1"}'),
    );
    expect(failed.status).toBe(500);
    expect(await failed.json()).toEqual({ error: 'Processing failed' });
  });
});

describe('the shared decision functions default to the console logger', () => {
  it('mintWebFormInstanceHttp and processWebhookHttp log through console when no logger is given', async () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    await mintWebFormInstanceHttp({
      userId: 'u',
      body: undefined,
      mint: () => Promise.reject(new Error('x')),
    });
    await processWebhookHttp({
      provider: provider(),
      envelopes: { handleWebhookEvent: () => Promise.reject('weird') },
      headers: {},
      rawBody: '{"envelopeId":"ds-1"}',
    });
    expect(errorSpy).toHaveBeenCalledWith(
      'Web Forms instance creation failed:',
      'UNKNOWN_ERROR',
    );
    expect(errorSpy).toHaveBeenCalledWith('Webhook processing error:', 'weird');
    errorSpy.mockRestore();
  });
});
