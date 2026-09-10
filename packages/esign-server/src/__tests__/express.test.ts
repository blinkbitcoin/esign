// The Express router: HTTP semantics of the esign endpoints over a fake
// provider and the in-memory domain. The host's auth, CORS and rate limits
// arrive as options; the router owns status codes and bodies.

import { spyLogger } from './support';
import express, { type RequestHandler } from 'express';
import request from 'supertest';
import { createEnvelopeService } from '../envelopes';
import { createESignRouter, type ESignRouterOptions } from '../express';
import { LOCKED_FIELDS_HINT } from '../pages';
import type { ESignProvider } from '../provider';
import { createMemoryEnvelopeStore } from '../store';
import type { WebhookEvent } from '../types';

const silentLogger = spyLogger();

const fakeProvider = (
  overrides: Partial<ESignProvider> = {},
): ESignProvider => ({
  createEnvelope: jest.fn(),
  getEnvelopeStatus: jest.fn(),
  getSigningUrl: jest.fn(),
  verifyWebhook: jest.fn().mockReturnValue(true),
  parseWebhookEvent: jest
    .fn()
    .mockImplementation((raw: string): WebhookEvent | null => {
      try {
        const body = JSON.parse(raw) as {
          envelopeId?: string;
          status?: string;
        };
        return body.envelopeId
          ? {
              providerEnvelopeId: body.envelopeId,
              rawStatus: body.status ?? '',
              status: body.status === 'completed' ? 'completed' : null,
            }
          : null;
      } catch {
        return null;
      }
    }),
  createWebFormInstance: jest
    .fn()
    .mockResolvedValue({ url: 'https://f#instanceToken=T', instanceId: 'i-1' }),
  ...overrides,
});

const build = (
  overrides: Partial<ESignRouterOptions> = {},
  provider = fakeProvider(),
) => {
  const store = createMemoryEnvelopeStore();
  const envelopes = createEnvelopeService({
    provider,
    store,
    logger: silentLogger,
  });
  const app = express();
  app.use(
    createESignRouter({
      envelopes,
      provider,
      authenticate: req =>
        req.headers.authorization === 'Bearer user-1' ? 'user-1' : null,
      mockPages: {
        getWebFormPrefill: id =>
          id === 'minted' ? { units: 1000 } : undefined,
      },
      logger: silentLogger,
      ...overrides,
    }),
  );
  return { app, store, envelopes, provider };
};

describe('GET /health', () => {
  it('answers ok with a timestamp', async () => {
    const { app } = build();
    const response = await request(app).get('/health');
    expect(response.status).toBe(200);
    expect(response.body.status).toBe('ok');
    expect(typeof response.body.timestamp).toBe('string');
  });
});

describe('signing pages', () => {
  it('serves the return-URL bridge with a nonce CSP, forwarding the event', async () => {
    const { app } = build();
    const response = await request(app).get(
      '/signing/return?event=signing_complete',
    );
    expect(response.status).toBe(200);
    expect(response.type).toBe('text/html');
    const csp = response.headers['content-security-policy'];
    const nonce = /script-src 'nonce-([^']+)'/.exec(csp)?.[1];
    expect(nonce).toBeTruthy();
    expect(csp).toContain(`style-src 'nonce-${nonce}'`);
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain('frame-ancestors *');
    expect(response.text).toContain(`<script nonce="${nonce}">`);
    expect(response.text).toContain('postSigningEvent("signing_complete")');
  });

  it('treats a missing or repeated event as exception', async () => {
    const { app } = build();
    expect((await request(app).get('/signing/return')).text).toContain(
      'postSigningEvent("exception")',
    );
    expect(
      (await request(app).get('/signing/return?event=a&event=b')).text,
    ).toContain('postSigningEvent("exception")');
  });

  it('serves the mock signing page and the mock web-form page (locked minted prefill, editable query prefill)', async () => {
    const { app } = build();
    const signing = await request(app).get('/signing/mock/env-1');
    expect(signing.status).toBe(200);
    expect(signing.text).toContain('Envelope env-1');

    const minted = await request(app).get(
      '/signing/mock-webform/minted?country=Sweden',
    );
    expect(minted.text).toContain('name="units" value="1000" readonly');
    expect(minted.text).toContain('name="country" value="Sweden" />');
    expect(minted.text).toContain(LOCKED_FIELDS_HINT);

    const unknown = await request(app).get('/signing/mock-webform/public-demo');
    expect(unknown.text).not.toContain('<form');
  });

  it('does not serve the mock pages when mockPages is off (the bridge stays)', async () => {
    const { app } = build({ mockPages: undefined });
    expect((await request(app).get('/signing/mock/env-1')).status).toBe(404);
    expect((await request(app).get('/signing/mock-webform/x')).status).toBe(
      404,
    );
    expect((await request(app).get('/signing/return')).status).toBe(200);
  });
});

describe('POST /webform/instance', () => {
  it('mints for an authenticated caller, forwarding the typed prefill', async () => {
    const { app, provider } = build();
    const response = await request(app)
      .post('/webform/instance')
      .set('authorization', 'Bearer user-1')
      .send({ prefill: { units: 1000, name: 'Jane' } });
    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      url: 'https://f#instanceToken=T',
      instanceId: 'i-1',
    });
    expect(provider.createWebFormInstance).toHaveBeenCalledWith('user-1', {
      units: 1000,
      name: 'Jane',
    });
  });

  it('treats a bodyless request as an empty prefill', async () => {
    const { app, provider } = build();
    const response = await request(app)
      .post('/webform/instance')
      .set('authorization', 'Bearer user-1');
    expect(response.status).toBe(200);
    expect(provider.createWebFormInstance).toHaveBeenCalledWith('user-1', {});
  });

  it('rejects an unauthenticated caller with 401', async () => {
    const { app, provider } = build();
    const response = await request(app)
      .post('/webform/instance')
      .send({ prefill: {} });
    expect(response.status).toBe(401);
    expect(provider.createWebFormInstance).not.toHaveBeenCalled();
  });

  it('answers 400 when the provider has no Web Forms capability', async () => {
    const provider = fakeProvider();
    delete (provider as { createWebFormInstance?: unknown })
      .createWebFormInstance;
    const { app } = build({}, provider);
    const response = await request(app)
      .post('/webform/instance')
      .set('authorization', 'Bearer user-1');
    expect(response.status).toBe(400);
    expect(response.body.error).toMatch(/not supported/);
  });

  it('answers 400 with the reason for a malformed prefill, before the provider', async () => {
    const { app, provider } = build();
    const response = await request(app)
      .post('/webform/instance')
      .set('authorization', 'Bearer user-1')
      .send({ prefill: { units: true } });
    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      error: 'Invalid prefill: unsupported value for field "units"',
    });
    expect(provider.createWebFormInstance).not.toHaveBeenCalled();
  });

  it('answers 502 when the provider fails, logging the error code only', async () => {
    const provider = fakeProvider({
      createWebFormInstance: jest
        .fn()
        .mockRejectedValue({ extensions: { code: 'PROVIDER_UNAVAILABLE' } }),
    });
    const { app } = build({}, provider);
    const response = await request(app)
      .post('/webform/instance')
      .set('authorization', 'Bearer user-1');
    expect(response.status).toBe(502);
    expect(response.body).toEqual({
      error: 'Could not create signing session',
    });
    expect(silentLogger.error).toHaveBeenCalledWith(
      'Web Forms instance creation failed:',
      'PROVIDER_UNAVAILABLE',
    );
  });

  it('runs the host middleware: cors on preflight, webform chain on POST', async () => {
    const seen: string[] = [];
    const tag =
      (name: string): RequestHandler =>
      (_req, _res, next) => {
        seen.push(name);
        next();
      };
    const { app } = build({
      middleware: { cors: tag('cors'), webform: [tag('limit'), tag('cors')] },
    });
    await request(app).options('/webform/instance');
    await request(app)
      .post('/webform/instance')
      .set('authorization', 'Bearer user-1');
    expect(seen).toEqual(['cors', 'limit', 'cors']);
  });

  it('supports an async authenticate and the default (console) logger', async () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const provider = fakeProvider({
      createWebFormInstance: jest.fn().mockRejectedValue(new Error('x')),
    });
    const { app } = build(
      { authenticate: async () => 'user-9', logger: undefined },
      provider,
    );
    const response = await request(app).post('/webform/instance');
    expect(response.status).toBe(502);
    expect(errorSpy).toHaveBeenCalledWith(
      'Web Forms instance creation failed:',
      'UNKNOWN_ERROR',
    );
    errorSpy.mockRestore();
  });
});

describe('POST /webhook/esign', () => {
  const seed = async (store: ReturnType<typeof createMemoryEnvelopeStore>) =>
    store.createEnvelope({
      id: 'env-1',
      providerEnvelopeId: 'ds-1',
      userId: 'user-1',
      contractType: 'c',
      status: 'sent',
    });

  it('verifies the raw body, parses and applies the event', async () => {
    const { app, store, provider } = build();
    await seed(store);
    const raw = '{"envelopeId":"ds-1","status":"completed"}';
    const response = await request(app)
      .post('/webhook/esign')
      .set('content-type', 'application/json')
      .set('x-docusign-signature-1', 'sig')
      .send(raw);
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ received: true });
    expect(provider.verifyWebhook).toHaveBeenCalledWith(
      expect.objectContaining({ 'x-docusign-signature-1': 'sig' }),
      raw,
      expect.any(String),
    );
    expect((await store.getEnvelopeById('env-1'))?.status).toBe('completed');
  });

  it('answers 401 when the provider rejects the signature, without parsing', async () => {
    const provider = fakeProvider({
      verifyWebhook: jest.fn().mockReturnValue(false),
    });
    const { app } = build({}, provider);
    const response = await request(app)
      .post('/webhook/esign')
      .set('content-type', 'application/json')
      .send('{}');
    expect(response.status).toBe(401);
    expect(provider.parseWebhookEvent).not.toHaveBeenCalled();
  });

  it('answers 400 for a payload the provider cannot parse', async () => {
    const { app } = build();
    const response = await request(app)
      .post('/webhook/esign')
      .set('content-type', 'application/json')
      .send('nope');
    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: 'Invalid payload' });
  });

  it('treats a non-text body (wrong content type) as an empty raw body', async () => {
    const { app, provider } = build();
    await request(app)
      .post('/webhook/esign')
      .set('content-type', 'text/plain')
      .send('x');
    expect(provider.verifyWebhook).toHaveBeenCalledWith(
      expect.anything(),
      '',
      expect.any(String),
    );
  });

  it('answers 500 when processing fails so the provider retries', async () => {
    const { app, store } = build();
    await seed(store);
    jest
      .spyOn(store, 'getEnvelopeByProviderEnvelopeId')
      .mockRejectedValueOnce(new Error('db down'));
    const response = await request(app)
      .post('/webhook/esign')
      .set('content-type', 'application/json')
      .send('{"envelopeId":"ds-1","status":"completed"}');
    expect(response.status).toBe(500);
    expect(response.body).toEqual({ error: 'Processing failed' });
    expect(silentLogger.error).toHaveBeenCalledWith(
      'Webhook processing error:',
      'db down',
    );
  });

  it('logs a non-Error processing failure as is', async () => {
    const { app, store } = build();
    await seed(store);
    jest
      .spyOn(store, 'getEnvelopeByProviderEnvelopeId')
      .mockRejectedValueOnce('weird');
    await request(app)
      .post('/webhook/esign')
      .set('content-type', 'application/json')
      .send('{"envelopeId":"ds-1","status":"completed"}');
    expect(silentLogger.error).toHaveBeenCalledWith(
      'Webhook processing error:',
      'weird',
    );
  });

  it('runs the host webhook middleware and honours the body limit', async () => {
    const seen: string[] = [];
    const { app } = build({
      middleware: {
        webhook: [
          (_req, _res, next) => {
            seen.push('limit');
            next();
          },
        ],
      },
      bodyLimit: '1kb',
    });
    const tooBig = JSON.stringify({
      envelopeId: 'ds-1',
      pad: 'x'.repeat(2000),
    });
    const response = await request(app)
      .post('/webhook/esign')
      .set('content-type', 'application/json')
      .send(tooBig);
    expect(seen).toEqual(['limit']);
    expect(response.status).toBe(413);
  });
});
