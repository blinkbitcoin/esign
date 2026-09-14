// The mint contract, enforced once: every row below runs through BOTH public
// Fetch presets (createHostedFormApp, createEnvelopeApp), so the two kinds
// cannot drift apart. The structural guard is the last block: every public
// preset reaches its kind's request parser, which only the one decision
// function calls, so a preset built beside the stack fails there. What
// differs between the kinds is their members, tested on the kind objects.

import { Errors } from '../errors';
import { createEnvelopeRouter, createHostedFormRouter } from '../express';
import {
  createEnvelopeApp,
  createEnvelopeInstanceHandler,
  createHostedFormApp,
  createHostedFormInstanceHandler,
  ENVELOPE_MINT,
  type HostedFormApp,
  mintEnvelopeInstanceHttp,
  mintWebFormInstanceHttp,
  mintWithPrefillHook,
  WEB_FORM_MINT,
} from '../handlers';
import express from 'express';
import supertest from 'supertest';
import type { ESignProvider } from '../provider';
import { parseEnvelopePrefill } from '../providers/docusign/prefill';
import { spyLogger } from './support';

const silent = spyLogger();

const post = (
  url: string,
  body?: string,
  headers: Record<string, string> = {},
) => new Request(url, { method: 'POST', body, headers });

const provider = (overrides: Partial<ESignProvider> = {}): ESignProvider => ({
  createEnvelope: jest
    .fn()
    .mockResolvedValue({ envelopeId: 'env-1', signingUrl: 'https://s/1' }),
  getEnvelopeStatus: jest.fn(),
  getSigningUrl: jest.fn(),
  verifyWebhook: jest.fn().mockReturnValue(true),
  parseWebhookEvent: jest.fn(),
  createWebFormInstance: jest
    .fn()
    .mockResolvedValue({ url: 'https://f#instanceToken=T', instanceId: 'i-1' }),
  ...overrides,
});

const authenticate = (request: Request) =>
  request.headers.get('authorization') === 'Bearer user-1' ? 'user-1' : null;

// Synthetic signer and terms - nothing here is anyone's data
const signer = { name: 'Test Signer', email: 'signer@example.com' };
const locked = { total_usd: { value: '1000.00', locked: true } };

// One row per kind: how its preset is built, what a good request and its
// answer look like, and what its hook decides
interface Kind {
  name: string;
  path: string;
  other: string;
  body: object;
  answer: object;
  failure: string;
  unsupported: string;
  called: (p: ESignProvider) => void;
  failing: () => ESignProvider;
  // The preset over a target, with the host's hook when given
  app: (options: {
    provider?: ESignProvider;
    mint?: undefined;
    hook?: 'decide' | 'reject' | 'refuse';
    path?: string;
    health?: boolean;
    cors?: { origins: string[] };
    parsePrefill?: (input: unknown) => { ok: false; error: string };
    logger?: ReturnType<typeof spyLogger>;
  }) => HostedFormApp;
  decided: (p: ESignProvider) => void;
}

const hooks = {
  decide: async () => undefined,
  reject: async () => {
    throw Errors.validationError('units out of range');
  },
  refuse: async () => {
    throw Errors.unauthorized();
  },
};

const kinds: Kind[] = [
  {
    name: 'the Web Forms mint',
    path: '/webform/instance',
    other: '/envelope/instance',
    body: { prefill: { units: 1000 } },
    answer: { url: 'https://f#instanceToken=T', instanceId: 'i-1' },
    failure: 'Web Forms instance creation failed:',
    unsupported: 'Web Forms not supported by the configured provider',
    called: p =>
      expect(p.createWebFormInstance).toHaveBeenCalledWith('user-1', {
        units: 1000,
      }),
    failing: () =>
      provider({
        createWebFormInstance: jest.fn().mockRejectedValue(new Error('down')),
      }),
    app: ({ hook, ...options }) =>
      createHostedFormApp({
        authenticate,
        logger: silent,
        ...options,
        ...(hook
          ? {
              prefill:
                hook === 'decide'
                  ? async ({ prefill }: { prefill: { units?: number } }) => ({
                      ...prefill,
                      total_usd: '1000.00',
                    })
                  : hooks[hook],
            }
          : {}),
      } as Parameters<typeof createHostedFormApp>[0]),
    decided: p =>
      expect(p.createWebFormInstance).toHaveBeenCalledWith('user-1', {
        units: 1000,
        total_usd: '1000.00',
      }),
  },
  {
    name: 'the envelope mint',
    path: '/envelope/instance',
    other: '/webform/instance',
    body: { recipient: signer, prefill: locked },
    answer: { url: 'https://s/1', envelopeId: 'env-1' },
    failure: 'Envelope creation failed:',
    unsupported: 'Envelopes not supported by the configured provider',
    called: p =>
      expect(p.createEnvelope).toHaveBeenCalledWith(
        'user-1',
        'agreement',
        signer,
        locked,
      ),
    failing: () =>
      provider({
        createEnvelope: jest.fn().mockRejectedValue(new Error('down')),
      }),
    app: ({ hook, ...options }) =>
      createEnvelopeApp({
        authenticate,
        logger: silent,
        ...options,
        ...(hook
          ? {
              terms:
                hook === 'decide'
                  ? async () => ({
                      recipient: { name: 'Verified', email: 'v@example.com' },
                      prefill: locked,
                    })
                  : hooks[hook],
            }
          : {}),
      } as Parameters<typeof createEnvelopeApp>[0]),
    decided: p =>
      expect(p.createEnvelope).toHaveBeenCalledWith(
        'user-1',
        'agreement',
        { name: 'Verified', email: 'v@example.com' },
        locked,
      ),
  },
];

describe.each(kinds)('$name serves the mint contract', kind => {
  const base = 'https://api.example.com';
  const mintAs = (body: unknown = kind.body, path = kind.path) =>
    post(
      `${base}${path}`,
      body === undefined ? undefined : JSON.stringify(body),
      { authorization: 'Bearer user-1' },
    );

  it('mints for an authenticated caller and answers what the provider minted', async () => {
    const p = provider();
    const response = await kind.app({ provider: p }).fetch(mintAs());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(kind.answer);
    kind.called(p);
  });

  it('answers 401 without a verified caller, before the provider', async () => {
    const p = provider();
    const response = await kind
      .app({ provider: p })
      .fetch(post(`${base}${kind.path}`, JSON.stringify(kind.body)));
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'Unauthorized' });
    expect(p.createEnvelope).not.toHaveBeenCalled();
    expect(p.createWebFormInstance).not.toHaveBeenCalled();
  });

  it('answers 400 for a body that is not JSON', async () => {
    const response = await kind.app({ provider: provider() }).fetch(
      post(`${base}${kind.path}`, '{nope', {
        authorization: 'Bearer user-1',
      }),
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'Invalid JSON body' });
  });

  it("answers 400 with the prefill contract's reason, before the provider", async () => {
    const p = provider();
    const response = await kind
      .app({
        provider: p,
        parsePrefill: () => ({ ok: false, error: 'not a value' }),
      })
      .fetch(mintAs());
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: 'Invalid prefill: not a value',
    });
    expect(p.createEnvelope).not.toHaveBeenCalled();
    expect(p.createWebFormInstance).not.toHaveBeenCalled();
  });

  it('answers 400 for a target without a mint', async () => {
    const response = await kind.app({ mint: undefined }).fetch(mintAs());
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: kind.unsupported });
  });

  it('answers 502 when the provider fails, logging the error code only', async () => {
    const logger = spyLogger();
    const response = await kind
      .app({ provider: kind.failing(), logger })
      .fetch(mintAs());
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({
      error: 'Could not create signing session',
    });
    expect(logger.error).toHaveBeenCalledWith(kind.failure, 'UNKNOWN_ERROR');
  });

  it('mints what the host hook decides, not what the caller sent', async () => {
    const p = provider();
    const response = await kind
      .app({ provider: p, hook: 'decide' })
      .fetch(mintAs());
    expect(response.status).toBe(200);
    kind.decided(p);
  });

  it('runs the hook only after validation', async () => {
    const p = provider();
    const response = await kind
      .app({
        provider: p,
        hook: 'reject',
        parsePrefill: () => ({ ok: false, error: 'not a value' }),
      })
      .fetch(mintAs());
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: 'Invalid prefill: not a value',
    });
  });

  it('answers the hook rejecting the caller as 400 with the message, or 401', async () => {
    const rejected = await kind
      .app({ provider: provider(), hook: 'reject' })
      .fetch(mintAs());
    expect(rejected.status).toBe(400);
    expect(await rejected.json()).toEqual({ error: 'units out of range' });

    const refused = await kind
      .app({ provider: provider(), hook: 'refuse' })
      .fetch(mintAs());
    expect(refused.status).toBe(401);
    expect(await refused.json()).toEqual({ error: 'Unauthorized' });
  });

  it('takes a custom path and serves no other mint', async () => {
    const app = kind.app({ provider: provider(), path: '/mint' });
    expect((await app.fetch(mintAs(kind.body, '/mint'))).status).toBe(200);
    expect((await app.fetch(mintAs())).status).toBe(404);
    expect((await app.fetch(mintAs(kind.body, kind.other))).status).toBe(404);
  });

  it('serves the return bridge under the nonce CSP and a health check', async () => {
    const app = kind.app({ provider: provider() });
    const bridge = await app.fetch(
      new Request(`${base}/signing/return?event=signing_complete`),
    );
    expect(bridge.status).toBe(200);
    expect(bridge.headers.get('content-type')).toContain('text/html');
    expect(bridge.headers.get('content-security-policy')).toMatch(/nonce-/);
    expect(await bridge.text()).toContain('signing_complete');
    // Without an event the bridge still answers (the page reports it as an
    // exception)
    expect(
      (await app.fetch(new Request(`${base}/signing/return`))).status,
    ).toBe(200);

    const health = await app.fetch(new Request(`${base}/health`));
    expect(health.status).toBe(200);
    expect(await health.json()).toMatchObject({ status: 'ok' });
  });

  it('leaves the health check out when told to, and 404s everything else', async () => {
    const other = await kind
      .app({ provider: provider() })
      .fetch(new Request(`${base}/nope`));
    expect(other.status).toBe(404);
    expect(await other.json()).toEqual({ error: 'Not found' });

    const quiet = kind.app({ provider: provider(), health: false });
    expect((await quiet.fetch(new Request(`${base}/health`))).status).toBe(404);
  });

  it('answers the preflight and echoes an allowed origin, ignoring others', async () => {
    const app = kind.app({
      provider: provider(),
      cors: { origins: ['https://app.example.com'] },
    });
    const preflight = await app.fetch(
      new Request(`${base}${kind.path}`, {
        method: 'OPTIONS',
        headers: { origin: 'https://app.example.com' },
      }),
    );
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get('access-control-allow-origin')).toBe(
      'https://app.example.com',
    );
    expect(preflight.headers.get('access-control-allow-methods')).toBe(
      'POST, OPTIONS',
    );

    const minted = await app.fetch(
      post(`${base}${kind.path}`, JSON.stringify(kind.body), {
        authorization: 'Bearer user-1',
        origin: 'https://elsewhere.example.com',
      }),
    );
    expect(minted.headers.get('access-control-allow-origin')).toBeNull();
    expect(minted.headers.get('vary')).toBe('origin');

    // No Origin at all still varies, so a shared cache never serves this
    // answer to an allowed origin
    const direct = await app.fetch(mintAs());
    expect(direct.headers.get('access-control-allow-origin')).toBeNull();
    expect(direct.headers.get('vary')).toBe('origin');
  });
});

describe('WEB_FORM_MINT, the kind', () => {
  it('reads the prefill out of the body, an empty one when there is no body', () => {
    expect(
      WEB_FORM_MINT.parseRequest(
        { prefill: { units: 1 } },
        WEB_FORM_MINT.parsePrefill,
      ),
    ).toEqual({ ok: true, input: { prefill: { units: 1 } } });
    expect(
      WEB_FORM_MINT.parseRequest(undefined, WEB_FORM_MINT.parsePrefill),
    ).toEqual({
      ok: true,
      input: { prefill: {} },
    });
  });

  it('mints over a provider with the capability, and nothing over one without', async () => {
    const p = provider();
    const mint = WEB_FORM_MINT.mint(p);
    await expect(mint?.('user-1', { prefill: { units: 1 } })).resolves.toEqual({
      url: 'https://f#instanceToken=T',
      instanceId: 'i-1',
    });
    expect(
      WEB_FORM_MINT.mint(provider({ createWebFormInstance: undefined })),
    ).toBeUndefined();
  });

  // The public hook takes and answers the prefill itself
  it('keeps a mint-less target mint-less through mintWithPrefillHook, and applies the hook', async () => {
    expect(
      mintWithPrefillHook(undefined, async () => ({}), {}),
    ).toBeUndefined();
    const mint = jest.fn().mockResolvedValue({ url: 'u' });
    const hooked = mintWithPrefillHook(
      mint,
      async ({ prefill, tag }: { prefill: object; tag: string }) => ({
        ...prefill,
        tag,
      }),
      { tag: 't' },
    );
    await expect(hooked?.('user-1', { units: 1 })).resolves.toEqual({
      url: 'u',
    });
    expect(mint).toHaveBeenCalledWith('user-1', { units: 1, tag: 't' });
  });
});

describe('ENVELOPE_MINT, the kind', () => {
  const parse = (body: unknown) =>
    ENVELOPE_MINT.parseRequest(body, ENVELOPE_MINT.parsePrefill);

  it('reads the signer and the prefill out of the body, either absent', () => {
    expect(parse({ recipient: signer, prefill: locked })).toEqual({
      ok: true,
      input: { recipient: signer, prefill: locked },
    });
    // A prefill the caller did not send stays absent (the template keeps
    // its own values); a body that is not an object names nothing
    expect(parse({ recipient: signer })).toEqual({
      ok: true,
      input: { recipient: signer, prefill: undefined },
    });
    expect(parse('nope')).toEqual({
      ok: true,
      input: { recipient: undefined, prefill: undefined },
    });
  });

  it('refuses a signer that is not a name and an email, and a prefill outside the contract', () => {
    expect(parse({ recipient: { name: 'Only' } })).toEqual({
      ok: false,
      error:
        'Invalid recipient: recipient must be an object with a name and an email',
    });
    expect(parse({ recipient: signer, prefill: 'nope' })).toMatchObject({
      ok: false,
      error: expect.stringMatching(/^Invalid prefill: /),
    });
    expect(ENVELOPE_MINT.parsePrefill).toBe(parseEnvelopePrefill);
  });

  it('creates the envelope under the agreement contract type and answers its URL and id', async () => {
    const p = provider();
    await expect(
      ENVELOPE_MINT.mint(p)?.('user-1', { recipient: signer, prefill: locked }),
    ).resolves.toEqual({ url: 'https://s/1', envelopeId: 'env-1' });
    expect(p.createEnvelope).toHaveBeenCalledWith(
      'user-1',
      'agreement',
      signer,
      locked,
    );
  });

  it("refuses a request that ends up with no signer, or one outside the package's rules", async () => {
    const mint = ENVELOPE_MINT.mint(provider());
    await expect(mint?.('user-1', {})).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'recipient is required: a name and an email',
    });
    await expect(
      mint?.('user-1', { recipient: { name: 'X', email: 'not-an-email' } }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('is the target of createEnvelopeInstanceHandler and mintEnvelopeInstanceHttp', async () => {
    const p = provider();
    const response = await createEnvelopeInstanceHandler({
      provider: p,
      authenticate,
      logger: silent,
    })(
      post(
        'https://api.example.com/envelope/instance',
        JSON.stringify({ recipient: signer }),
        { authorization: 'Bearer user-1' },
      ),
    );
    expect(response.status).toBe(200);
    expect(p.createEnvelope).toHaveBeenCalledWith(
      'user-1',
      'agreement',
      signer,
      undefined,
    );

    // The decision function alone, logging through the console by default
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const result = await mintEnvelopeInstanceHttp({
      userId: 'u',
      body: { recipient: signer },
      mint: () => Promise.reject(new Error('x')),
    });
    expect(result.status).toBe(502);
    expect(errorSpy).toHaveBeenCalledWith(
      'Envelope creation failed:',
      'UNKNOWN_ERROR',
    );
    errorSpy.mockRestore();
  });
});

// The structural guard: a kind's request parser is called by mintInstanceHttp
// and nothing else, so a preset that reaches it is the stack over that kind.
// A second stack written beside the first one never calls it and fails here.
describe('every public preset is the one stack over its kind', () => {
  const body = (kind: typeof WEB_FORM_MINT | typeof ENVELOPE_MINT) =>
    kind === WEB_FORM_MINT ? { prefill: { units: 1 } } : { recipient: signer };

  const fetchPresets = {
    createHostedFormInstanceHandler: () =>
      createHostedFormInstanceHandler({ provider: provider(), authenticate }),
    createEnvelopeInstanceHandler: () =>
      createEnvelopeInstanceHandler({ provider: provider(), authenticate }),
    createHostedFormApp: () =>
      createHostedFormApp({ provider: provider(), authenticate }).fetch,
    createEnvelopeApp: () =>
      createEnvelopeApp({ provider: provider(), authenticate }).fetch,
  };

  it.each([
    ['mintWebFormInstanceHttp', WEB_FORM_MINT],
    ['mintEnvelopeInstanceHttp', ENVELOPE_MINT],
  ] as const)('%s', async (name, kind) => {
    const parseRequest = jest.spyOn(kind, 'parseRequest');
    const decide =
      name === 'mintWebFormInstanceHttp'
        ? mintWebFormInstanceHttp
        : mintEnvelopeInstanceHttp;
    await decide({
      userId: 'user-1',
      body: body(kind),
      mint: jest.fn().mockResolvedValue({}),
    } as never);
    expect(parseRequest).toHaveBeenCalledTimes(1);
    parseRequest.mockRestore();
  });

  it.each([
    ['createHostedFormInstanceHandler', WEB_FORM_MINT],
    ['createHostedFormApp', WEB_FORM_MINT],
    ['createEnvelopeInstanceHandler', ENVELOPE_MINT],
    ['createEnvelopeApp', ENVELOPE_MINT],
  ] as const)('%s', async (name, kind) => {
    const parseRequest = jest.spyOn(kind, 'parseRequest');
    await fetchPresets[name]()(
      post(`https://api.example.com${kind.path}`, JSON.stringify(body(kind)), {
        authorization: 'Bearer user-1',
      }),
    );
    expect(parseRequest).toHaveBeenCalledTimes(1);
    parseRequest.mockRestore();
  });

  it.each([
    ['createHostedFormRouter', WEB_FORM_MINT],
    ['createEnvelopeRouter', ENVELOPE_MINT],
  ] as const)('%s', async (name, kind) => {
    const parseRequest = jest.spyOn(kind, 'parseRequest');
    const app = express();
    const options = {
      provider: provider(),
      authenticate: (req: express.Request) =>
        req.headers.authorization === 'Bearer user-1' ? 'user-1' : null,
    };
    app.use(
      name === 'createHostedFormRouter'
        ? createHostedFormRouter(options)
        : createEnvelopeRouter(options),
    );
    await supertest(app)
      .post(kind.path)
      .set('authorization', 'Bearer user-1')
      .send(body(kind));
    expect(parseRequest).toHaveBeenCalledTimes(1);
    parseRequest.mockRestore();
  });
});
