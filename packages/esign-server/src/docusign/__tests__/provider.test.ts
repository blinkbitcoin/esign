import { createHmac } from 'node:crypto';
import type { DocuSignClient } from '../client';
import type { DocuSignConfig } from '../config';
import { HttpError } from '../../http';
import { type ESignProvider, supportsWebForms } from '../../provider';
import {
  createDocuSignProvider,
  DOCUSIGN_SIGNATURE_HEADER,
  type DocuSignProviderOptions,
  mapDocuSignStatus,
  mapWebhookStatus,
  parseDocuSignWebhook,
} from '../provider';
import { fakeFetch, ok, testConfig, token } from '../../__tests__/support';

const recipient = { name: 'Jane Signer', email: 'jane@example.com' };

// Narrow the optional Web Forms capability (fails loudly if it disappears)
const webForms = (provider: ESignProvider) => {
  if (!supportsWebForms(provider)) {
    throw new Error('provider has no Web Forms support');
  }
  return provider;
};

// withRetry sleeps 1s + 2s between attempts; make setTimeout fire at once
let setTimeoutSpy: jest.SpyInstance;
beforeAll(() => {
  setTimeoutSpy = jest.spyOn(globalThis, 'setTimeout').mockImplementation(((
    fn: () => void,
  ) => {
    fn();
    return 0;
  }) as unknown as typeof setTimeout);
});
afterAll(() => {
  setTimeoutSpy.mockRestore();
});

const fakeClient = (config: DocuSignConfig) => ({
  config,
  getAccessToken: jest.fn(async () => 'tok'),
  clearTokenCache: jest.fn(),
  createEnvelopeFromTemplate: jest.fn(async () => ({ envelopeId: 'ds-1' })),
  getEmbeddedSigningUrl: jest.fn(async () => 'https://docusign.example/sign'),
  fetchEnvelopeStatus: jest.fn(async () => ({ status: 'sent' })),
  createWebFormInstanceRequest: jest.fn(async () => ({
    url: 'https://f#instanceToken=T',
    instanceId: 'i-1',
  })),
});
type FakeClient = ReturnType<typeof fakeClient>;

const fakeLogger = () => ({
  log: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
});

const setup = (
  overrides: Partial<DocuSignProviderOptions> = {},
  config: DocuSignConfig = testConfig(),
) => {
  const clients: FakeClient[] = [];
  const createClient = jest.fn((cfg: DocuSignConfig) => {
    const client = fakeClient(cfg);
    clients.push(client);
    return client as unknown as DocuSignClient;
  });
  const logger = fakeLogger();
  const provider = createDocuSignProvider({
    config,
    webhook: { hmacKey: () => 'hmac-key', logger },
    createClient,
    ...overrides,
  });
  return {
    provider,
    createClient,
    clients,
    logger,
    client: () => clients[clients.length - 1],
  };
};

describe('mapDocuSignStatus', () => {
  it.each([
    ['sent', 'sent'],
    ['delivered', 'sent'],
    ['completed', 'completed'],
    ['signed', 'completed'],
    ['voided', 'voided'],
    ['declined', 'declined'],
    ['created', 'sent'],
    ['anything-else', 'sent'],
    ['COMPLETED', 'completed'],
    ['Voided', 'voided'],
  ])('maps %s to %s', (input, expected) => {
    expect(mapDocuSignStatus(input)).toBe(expected);
  });
});

describe('mapWebhookStatus', () => {
  it.each([
    ['completed', 'completed'],
    ['declined', 'declined'],
    ['voided', 'voided'],
    ['sent', 'sent'],
    ['Completed', 'completed'],
    ['DECLINED', 'declined'],
    ['delivered', null],
    ['unknown', null],
    ['', null],
  ])('maps %s to %p', (input, expected) => {
    expect(mapWebhookStatus(input)).toBe(expected);
  });
});

describe('parseDocuSignWebhook', () => {
  const payload = (data: unknown) =>
    JSON.stringify({ event: 'envelope-completed', data });

  it('normalizes a Connect payload into an event', () => {
    expect(
      parseDocuSignWebhook(
        payload({
          envelopeId: 'ds-1',
          envelopeSummary: { status: 'Completed', emailSubject: 'x' },
        }),
      ),
    ).toEqual({
      providerEnvelopeId: 'ds-1',
      rawStatus: 'Completed',
      status: 'completed',
    });
  });

  it('keeps the raw status and nulls the normalized one for untracked statuses', () => {
    expect(
      parseDocuSignWebhook(
        payload({
          envelopeId: 'ds-1',
          envelopeSummary: { status: 'delivered' },
        }),
      ),
    ).toEqual({
      providerEnvelopeId: 'ds-1',
      rawStatus: 'delivered',
      status: null,
    });
  });

  it('returns null for malformed payloads', () => {
    expect(parseDocuSignWebhook('not json')).toBeNull();
    expect(parseDocuSignWebhook('')).toBeNull();
    expect(parseDocuSignWebhook('{}')).toBeNull();
    expect(parseDocuSignWebhook(payload(undefined))).toBeNull();
    expect(
      parseDocuSignWebhook(
        payload({ envelopeSummary: { status: 'completed' } }),
      ),
    ).toBeNull();
    expect(parseDocuSignWebhook(payload({ envelopeId: 'ds-1' }))).toBeNull();
    expect(
      parseDocuSignWebhook(
        payload({ envelopeId: 'ds-1', envelopeSummary: {} }),
      ),
    ).toBeNull();
    expect(
      parseDocuSignWebhook(
        payload({ envelopeId: '', envelopeSummary: { status: 'completed' } }),
      ),
    ).toBeNull();
  });
});

describe('DOCUSIGN_SIGNATURE_HEADER', () => {
  it('is the lower-cased Connect header', () => {
    expect(DOCUSIGN_SIGNATURE_HEADER).toBe('x-docusign-signature-1');
  });
});

describe('createDocuSignProvider', () => {
  describe('client lifecycle', () => {
    it('builds one client lazily from the config object and reuses it', async () => {
      const config = testConfig();
      const { provider, createClient } = setup({}, config);
      expect(createClient).not.toHaveBeenCalled();
      await provider.getEnvelopeStatus('ds-1');
      await provider.getEnvelopeStatus('ds-1');
      expect(createClient).toHaveBeenCalledTimes(1);
      expect(createClient).toHaveBeenCalledWith(config);
    });

    it('accepts a config getter, read on each client creation, and reset() rebuilds the client', async () => {
      const getConfig = jest.fn(() => testConfig());
      const { provider, createClient, clients } = setup({ config: getConfig });
      await provider.getEnvelopeStatus('ds-1');
      expect(getConfig).toHaveBeenCalledTimes(1);
      provider.reset();
      await provider.getEnvelopeStatus('ds-1');
      expect(getConfig).toHaveBeenCalledTimes(2);
      expect(createClient).toHaveBeenCalledTimes(2);
      expect(clients[0]).not.toBe(clients[1]);
    });

    it('uses the real DocuSign client when no factory is injected', async () => {
      const original = globalThis.fetch;
      const { fetchImpl, calls } = fakeFetch([
        token(),
        ok({ status: 'completed' }),
      ]);
      globalThis.fetch = fetchImpl as unknown as typeof fetch;
      try {
        const provider = createDocuSignProvider({
          config: testConfig(),
          webhook: { hmacKey: () => undefined },
        });
        expect(await provider.getEnvelopeStatus('ds-1')).toBe('completed');
        expect(calls[1].url).toBe(
          `${testConfig().apiBaseUrl}/v2.1/accounts/acct-1/envelopes/ds-1`,
        );
      } finally {
        globalThis.fetch = original;
      }
    });
  });

  describe('createEnvelope', () => {
    it('creates from the template and mints the embedded signing url', async () => {
      const { provider, client } = setup();
      const result = await provider.createEnvelope('user-1', 'nda', recipient);
      expect(result).toEqual({
        envelopeId: 'ds-1',
        signingUrl: 'https://docusign.example/sign',
      });
      expect(client().createEnvelopeFromTemplate).toHaveBeenCalledWith(
        recipient,
      );
      expect(client().getEmbeddedSigningUrl).toHaveBeenCalledWith(
        'ds-1',
        recipient,
      );
    });

    it('maps a client error to ENVELOPE_CREATION_FAILED without retrying', async () => {
      const { provider, client } = setup();
      await provider.getEnvelopeStatus('ds-1');
      client().createEnvelopeFromTemplate.mockRejectedValue(
        new HttpError(400, 'bad template role'),
      );
      await expect(
        provider.createEnvelope('user-1', 'nda', recipient),
      ).rejects.toMatchObject({
        code: 'ENVELOPE_CREATION_FAILED',
        message: 'Failed to create envelope',
      });
      expect(client().createEnvelopeFromTemplate).toHaveBeenCalledTimes(1);
      expect(client().getEmbeddedSigningUrl).not.toHaveBeenCalled();
    });

    it('maps anything else, after retries, to PROVIDER_UNAVAILABLE', async () => {
      const { provider, client } = setup();
      await provider.getEnvelopeStatus('ds-1');
      client().getEmbeddedSigningUrl.mockRejectedValue(new Error('ECONNRESET'));
      await expect(
        provider.createEnvelope('user-1', 'nda', recipient),
      ).rejects.toMatchObject({ code: 'PROVIDER_UNAVAILABLE' });
      expect(client().getEmbeddedSigningUrl).toHaveBeenCalledTimes(3);

      client().createEnvelopeFromTemplate.mockRejectedValue(
        new HttpError(503, 'busy'),
      );
      await expect(
        provider.createEnvelope('user-1', 'nda', recipient),
      ).rejects.toMatchObject({ code: 'PROVIDER_UNAVAILABLE' });
    });
  });

  describe('getEnvelopeStatus', () => {
    it('maps the raw DocuSign status', async () => {
      const { provider, client } = setup();
      expect(await provider.getEnvelopeStatus('ds-1')).toBe('sent');
      expect(client().fetchEnvelopeStatus).toHaveBeenCalledWith('ds-1');
      client().fetchEnvelopeStatus.mockResolvedValueOnce({ status: 'Signed' });
      expect(await provider.getEnvelopeStatus('ds-1')).toBe('completed');
    });

    it('maps 404 to ENVELOPE_NOT_FOUND and everything else to PROVIDER_UNAVAILABLE', async () => {
      const { provider, client } = setup();
      await provider.getEnvelopeStatus('ds-1');
      client().fetchEnvelopeStatus.mockRejectedValueOnce(
        new HttpError(404, 'nope'),
      );
      await expect(provider.getEnvelopeStatus('ds-1')).rejects.toMatchObject({
        code: 'ENVELOPE_NOT_FOUND',
      });
      client().fetchEnvelopeStatus.mockRejectedValueOnce(
        new HttpError(401, 'expired'),
      );
      await expect(provider.getEnvelopeStatus('ds-1')).rejects.toMatchObject({
        code: 'PROVIDER_UNAVAILABLE',
      });
      client().fetchEnvelopeStatus.mockRejectedValue(new HttpError(500, 'x'));
      await expect(provider.getEnvelopeStatus('ds-1')).rejects.toMatchObject({
        code: 'PROVIDER_UNAVAILABLE',
      });
    });
  });

  describe('getSigningUrl', () => {
    it('returns a fresh embedded signing url', async () => {
      const { provider, client } = setup();
      expect(await provider.getSigningUrl('ds-1', recipient)).toEqual({
        signingUrl: 'https://docusign.example/sign',
      });
      expect(client().getEmbeddedSigningUrl).toHaveBeenCalledWith(
        'ds-1',
        recipient,
      );
    });

    it('maps any client error to ENVELOPE_NOT_FOUND, others to PROVIDER_UNAVAILABLE', async () => {
      const { provider, client } = setup();
      await provider.getSigningUrl('ds-1', recipient);
      client().getEmbeddedSigningUrl.mockRejectedValueOnce(
        new HttpError(404, 'gone'),
      );
      await expect(
        provider.getSigningUrl('ds-1', recipient),
      ).rejects.toMatchObject({ code: 'ENVELOPE_NOT_FOUND' });
      client().getEmbeddedSigningUrl.mockRejectedValueOnce(
        new HttpError(400, 'why'),
      );
      await expect(
        provider.getSigningUrl('ds-1', recipient),
      ).rejects.toMatchObject({ code: 'ENVELOPE_NOT_FOUND' });
      client().getEmbeddedSigningUrl.mockRejectedValue(new Error('timeout'));
      await expect(
        provider.getSigningUrl('ds-1', recipient),
      ).rejects.toMatchObject({ code: 'PROVIDER_UNAVAILABLE' });
    });
  });

  describe('verifyWebhook', () => {
    const body = '{"data":{"envelopeId":"ds-1"}}';
    const sign = (key: string) =>
      createHmac('sha256', key).update(body, 'utf8').digest('base64');

    it('accepts a body signed under the current key in X-DocuSign-Signature-1', () => {
      const { provider, logger } = setup();
      expect(
        provider.verifyWebhook(
          { [DOCUSIGN_SIGNATURE_HEADER]: sign('hmac-key') },
          body,
        ),
      ).toBe(true);
      expect(logger.error).not.toHaveBeenCalled();
    });

    it('reads the key per call (rotation)', () => {
      let key = 'old';
      const { provider } = setup({ webhook: { hmacKey: () => key } });
      const headers = { [DOCUSIGN_SIGNATURE_HEADER]: sign('new') };
      expect(provider.verifyWebhook(headers, body)).toBe(false);
      key = 'new';
      expect(provider.verifyWebhook(headers, body)).toBe(true);
    });

    it('treats a missing or repeated (array) header as no signature, logging the ip', () => {
      const { provider, logger } = setup();
      expect(provider.verifyWebhook({}, body, '10.0.0.1')).toBe(false);
      expect(
        provider.verifyWebhook(
          { [DOCUSIGN_SIGNATURE_HEADER]: [sign('hmac-key'), sign('hmac-key')] },
          body,
        ),
      ).toBe(false);
      expect(logger.error).toHaveBeenCalledTimes(2);
      expect(logger.error.mock.calls[0][1]).toContain(
        '"event":"Webhook received without signature"',
      );
      expect(logger.error.mock.calls[0][1]).toContain('"ip":"10.0.0.1"');
    });

    it('fails closed without a key unless allowMissingKey says otherwise', () => {
      const { provider: strict, logger } = setup({
        webhook: { hmacKey: () => undefined, logger: fakeLogger() },
      });
      expect(strict.verifyWebhook({}, body)).toBe(false);
      expect(logger.error).not.toHaveBeenCalled();

      const lenientLogger = fakeLogger();
      const lenient = createDocuSignProvider({
        config: testConfig(),
        webhook: {
          hmacKey: () => undefined,
          allowMissingKey: () => true,
          logger: lenientLogger,
        },
        createClient: cfg => fakeClient(cfg) as unknown as DocuSignClient,
      });
      expect(lenient.verifyWebhook({}, body)).toBe(true);
      expect(lenientLogger.warn).toHaveBeenCalledTimes(1);

      const flagged = createDocuSignProvider({
        config: testConfig(),
        webhook: { hmacKey: () => undefined, allowMissingKey: () => false },
      });
      const error = jest.spyOn(console, 'error').mockImplementation(() => {});
      expect(flagged.verifyWebhook({}, body)).toBe(false);
      expect(error).toHaveBeenCalledWith(
        'Security event:',
        expect.stringContaining('webhook rejected'),
      );
      error.mockRestore();
    });

    it('logs through console when the webhook options carry no logger', () => {
      const provider = createDocuSignProvider({
        config: testConfig(),
        webhook: { hmacKey: () => 'k' },
      });
      const error = jest.spyOn(console, 'error').mockImplementation(() => {});
      expect(provider.verifyWebhook({}, body)).toBe(false);
      expect(error).toHaveBeenCalledTimes(1);
      error.mockRestore();
    });
  });

  describe('parseWebhookEvent', () => {
    it('parses Connect payloads', () => {
      const { provider } = setup();
      expect(
        provider.parseWebhookEvent(
          JSON.stringify({
            data: { envelopeId: 'ds-1', envelopeSummary: { status: 'voided' } },
          }),
        ),
      ).toEqual({
        providerEnvelopeId: 'ds-1',
        rawStatus: 'voided',
        status: 'voided',
      });
      expect(provider.parseWebhookEvent('{')).toBeNull();
    });
  });

  describe('createWebFormInstance', () => {
    const prefill = { number_of_units: 1000 };

    it('fails with VALIDATION_ERROR when no form id is configured, before creating a client', async () => {
      const { provider, createClient } = setup(
        {},
        testConfig({ webFormId: undefined }),
      );
      await expect(
        webForms(provider).createWebFormInstance('user-1', prefill),
      ).rejects.toMatchObject({
        code: 'VALIDATION_ERROR',
        message: 'DOCUSIGN_WEBFORM_ID is not configured',
      });
      expect(createClient).not.toHaveBeenCalled();
    });

    it('mints the instance for the user with the configured return url', async () => {
      const { provider, client } = setup();
      const result = await webForms(provider).createWebFormInstance(
        'user-1',
        prefill,
      );
      expect(result).toEqual({
        url: 'https://f#instanceToken=T',
        instanceId: 'i-1',
      });
      expect(client().createWebFormInstanceRequest).toHaveBeenCalledWith(
        'user-1',
        prefill,
        {
          returnUrl: 'https://api.example.com/signing/return',
          expirationOffsetHours: undefined,
        },
      );
    });

    it('maps a client error to ENVELOPE_CREATION_FAILED and others to PROVIDER_UNAVAILABLE', async () => {
      const { provider, client } = setup();
      await webForms(provider).createWebFormInstance('user-1', prefill);
      client().createWebFormInstanceRequest.mockRejectedValueOnce(
        new HttpError(400, 'bad form values'),
      );
      await expect(
        webForms(provider).createWebFormInstance('user-1', prefill),
      ).rejects.toMatchObject({ code: 'ENVELOPE_CREATION_FAILED' });

      client().createWebFormInstanceRequest.mockRejectedValue(
        new HttpError(502, 'gateway'),
      );
      await expect(
        webForms(provider).createWebFormInstance('user-1', prefill),
      ).rejects.toMatchObject({ code: 'PROVIDER_UNAVAILABLE' });
      expect(client().createWebFormInstanceRequest).toHaveBeenCalledTimes(5);
    });

    it('surfaces a prefill validation failure as VALIDATION_ERROR without a network call', async () => {
      const { provider, client } = setup();
      await expect(
        webForms(provider).createWebFormInstance('user-1', {
          units: true,
        } as never),
      ).rejects.toMatchObject({
        code: 'VALIDATION_ERROR',
        message: 'Invalid prefill: unsupported value for field "units"',
      });
      expect(client().createWebFormInstanceRequest).not.toHaveBeenCalled();
    });
  });
});
