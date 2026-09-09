import {
  createWebFormsMinter,
  createWebFormsSource,
  resolveCreateInstance,
} from '../webFormsSource';

const reply = (status: number, json: unknown) =>
  ({ ok: status < 300, status, json: async () => json }) as Response;

describe('createWebFormsMinter', () => {
  it('POSTs the prefill to the endpoint with the session token', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValue(
        reply(200, { url: 'https://f#instanceToken=T', instanceId: 'i-1' }),
      );
    const mint = createWebFormsMinter(
      {
        url: 'https://api/webform/instance',
        getAuthToken: async () => 'jwt',
        fetch: fetchImpl,
      },
      { number_of_units: 1000, reference: 'E2E-0001' },
    );

    await expect(mint()).resolves.toEqual({
      url: 'https://f#instanceToken=T',
      envelopeId: 'i-1',
    });
    expect(fetchImpl).toHaveBeenCalledWith('https://api/webform/instance', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer jwt',
      },
      body: JSON.stringify({
        prefill: { number_of_units: 1000, reference: 'E2E-0001' },
      }),
    });
    // Numbers travel unquoted (DocuSign Number fields reject quoted numbers)
    expect(fetchImpl.mock.calls[0][1].body).toContain('"number_of_units":1000');
  });

  it('sends no Authorization header without a token, merges extra headers, defaults the prefill', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValue(reply(200, { url: 'https://f' }));
    await createWebFormsMinter({
      url: 'https://api/mint',
      getAuthToken: () => undefined,
      headers: { 'x-tenant': 'blink' },
      fetch: fetchImpl,
    })();
    expect(fetchImpl.mock.calls[0][1]).toEqual({
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-tenant': 'blink' },
      body: JSON.stringify({ prefill: {} }),
    });
  });

  it('prefers an envelopeId over an instanceId, and leaves it undefined otherwise', async () => {
    const both = jest
      .fn()
      .mockResolvedValue(
        reply(200, { url: 'u', envelopeId: 'e', instanceId: 'i' }),
      );
    await expect(
      createWebFormsMinter({
        url: 'x',
        getAuthToken: () => 't',
        fetch: both,
      })(),
    ).resolves.toEqual({
      url: 'u',
      envelopeId: 'e',
    });
    const neither = jest.fn().mockResolvedValue(reply(200, { url: 'u' }));
    await expect(
      createWebFormsMinter({
        url: 'x',
        getAuthToken: () => 't',
        fetch: neither,
      })(),
    ).resolves.toEqual({
      url: 'u',
      envelopeId: undefined,
    });
  });

  it('fails with the HTTP status on a non-2xx reply', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValue(reply(503, { error: 'down' }));
    await expect(
      createWebFormsMinter({
        url: 'x',
        getAuthToken: () => 't',
        fetch: fetchImpl,
      })(),
    ).rejects.toThrow('Could not mint the signing instance (HTTP 503)');
  });

  it('fails when the reply carries no url', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValue(reply(200, { instanceId: 'i' }));
    await expect(
      createWebFormsMinter({
        url: 'x',
        getAuthToken: () => 't',
        fetch: fetchImpl,
      })(),
    ).rejects.toThrow('The mint endpoint returned no instance url');
  });

  it('uses the global fetch when none is injected', async () => {
    const original = globalThis.fetch;
    globalThis.fetch = jest
      .fn()
      .mockResolvedValue(reply(200, { url: 'g' })) as unknown as typeof fetch;
    await expect(
      createWebFormsMinter({ url: 'x', getAuthToken: () => 't' })(),
    ).resolves.toEqual({
      url: 'g',
      envelopeId: undefined,
    });
    globalThis.fetch = original;
  });
});

describe('createWebFormsSource with mint', () => {
  it('start() mints through the endpoint and returns the session', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValue(
        reply(200, { url: 'https://f#instanceToken=T', instanceId: 'i-1' }),
      );
    const source = createWebFormsSource({
      mint: {
        url: 'https://api/webform/instance',
        getAuthToken: () => 'jwt',
        fetch: fetchImpl,
      },
      prefill: { units: 10 },
      allowedOrigin: 'https://apps.docusign.com',
    });
    await expect(source.start()).resolves.toEqual({
      url: 'https://f#instanceToken=T',
      envelopeId: 'i-1',
      allowedOrigin: 'https://apps.docusign.com',
    });
  });

  it('start() maps a failed mint to ENVELOPE_CREATION_FAILED with the reason', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(reply(401, {}));
    const source = createWebFormsSource({
      mint: { url: 'x', getAuthToken: () => undefined, fetch: fetchImpl },
    });
    await expect(source.start()).rejects.toMatchObject({
      code: 'ENVELOPE_CREATION_FAILED',
      message: 'Could not mint the signing instance (HTTP 401)',
    });
  });

  it('resolveCreateInstance keeps a host-provided createInstance as is', async () => {
    const createInstance = async () => ({ url: 'mine' });
    expect(resolveCreateInstance({ createInstance })).toBe(createInstance);
  });

  it('reads the return-URL bridge vocabulary as well as DocuSign.js sessionEnd', () => {
    const source = createWebFormsSource({
      mint: { url: 'x', getAuthToken: () => 't' },
    });
    // The bridge page (/signing/return) posts { event } - what a real form
    // finishing via returnUrl delivers into a plain WebView/iframe
    expect(source.interpret({ event: 'signing_complete' })).toEqual({
      type: 'complete',
      envelopeId: undefined,
    });
    expect(source.interpret({ event: 'cancel' })).toEqual({ type: 'cancel' });
    expect(source.interpret({ event: 'session_timeout' })).toEqual({
      type: 'sessionExpired',
    });
    // DocuSign.js
    expect(
      source.interpret({
        event: 'sessionEnd',
        type: 'signingResult',
        envelopeId: 'e',
      }),
    ).toEqual({
      type: 'complete',
      envelopeId: 'e',
    });
  });
});
