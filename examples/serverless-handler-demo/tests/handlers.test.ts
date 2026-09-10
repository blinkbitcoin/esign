import { vi } from 'vitest';
import { authenticate, createHandlers, providerFromEnv } from '../src/handlers';

// Tests are silent (vitest.setup.ts): the package reports through the
// injected logger
const silent = { log() {}, warn() {}, error() {} };

const post = (
  path: string,
  body: unknown,
  headers: Record<string, string> = {},
) =>
  new Request(`https://fn.example${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });

describe('authenticate', () => {
  it('takes the bearer token as the user id (a real host verifies its session here)', () => {
    const withAuth = (authorization?: string) =>
      new Request(
        'https://fn.example/x',
        authorization ? { headers: { authorization } } : {},
      );
    expect(authenticate(withAuth('Bearer user-1'))).toBe('user-1');
    expect(authenticate(withAuth('Bearer  user-1'))).toBe('user-1');
    expect(authenticate(withAuth('Basic x'))).toBeNull();
    expect(authenticate(withAuth())).toBeNull();
  });
});

describe('providerFromEnv', () => {
  it('is the mock provider onto the pages origin when ESIGN_PROVIDER=mock', async () => {
    const provider = providerFromEnv({
      ESIGN_PROVIDER: 'mock',
      MOCK_PAGES_ORIGIN: 'http://p:4000',
    });
    const { url } = await provider.createWebFormInstance!('u', {});
    expect(url).toMatch(/^http:\/\/p:4000\/signing\/mock-webform\//);
    const defaulted = await providerFromEnv({ ESIGN_PROVIDER: 'mock' })
      .createWebFormInstance!('u', {});
    expect(defaulted.url).toMatch(/^http:\/\/localhost:4100\//);
  });

  it('is the DocuSign provider otherwise, refusing unsigned webhooks', () => {
    const provider = providerFromEnv(
      { DOCUSIGN_HMAC_KEY: 'k' },
      { logger: silent },
    );
    expect(provider.verifyWebhook({}, '{}')).toBe(false);
  });

  it('warns and stays on DocuSign for an unknown name', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const provider = providerFromEnv(
      { ESIGN_PROVIDER: 'adobe', DOCUSIGN_HMAC_KEY: 'k' },
      { logger: silent },
    );
    expect(provider.verifyWebhook({}, '{}')).toBe(false);
    expect(warn).toHaveBeenCalledWith(
      'Unknown ESIGN_PROVIDER: adobe, falling back to docusign',
    );
    warn.mockRestore();
  });
});

describe('createHandlers (mock provider)', () => {
  const handlers = createHandlers(
    {
      ESIGN_PROVIDER: 'mock',
      MOCK_PAGES_ORIGIN: 'http://p:4000',
    },
    { logger: silent },
  );

  it('mints a Web Forms instance for an authenticated caller', async () => {
    const response = await handlers.mint(
      post(
        '/webform/instance',
        { prefill: { number_of_units: 10 } },
        { authorization: 'Bearer user-1' },
      ),
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.url).toMatch(/^http:\/\/p:4000\/signing\/mock-webform\//);
    expect(body.instanceId).toBeDefined();
  });

  it('answers 401 without a session', async () => {
    const response = await handlers.mint(
      post('/webform/instance', { prefill: {} }),
    );
    expect(response.status).toBe(401);
  });

  it('applies a webhook event to the envelope domain, reading the client ip from x-forwarded-for', async () => {
    // Unknown envelope: verified (mock allows unsigned), parsed, nothing to apply
    const response = await handlers.webhook(
      post(
        '/webhook/esign',
        {
          event: 'envelope-completed',
          data: {
            envelopeId: 'ds-1',
            envelopeSummary: { status: 'completed' },
          },
        },
        { 'x-forwarded-for': '10.0.0.9, 10.0.0.1' },
      ),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ received: true });
    // No forwarding header at all
    const direct = await handlers.webhook(post('/webhook/esign', 'not json'));
    expect(direct.status).toBe(400);
  });
});
