import { createServer, userFromAuthorization } from '../src/server';

// Tests are silent (vitest.setup.ts): the router reports a failed mint
// through the injected logger
const silent = { log() {}, warn() {}, error() {} };

const MUTATION =
  'mutation Sign($units: Int!) { investSigningUrl(units: $units) { url instanceId } }';

describe('userFromAuthorization', () => {
  it('takes the bearer token as the user id (a real host verifies its session here)', () => {
    expect(userFromAuthorization('Bearer user-1')).toBe('user-1');
    expect(userFromAuthorization('Bearer  user-1 ')).toBe('user-1');
    expect(userFromAuthorization('Basic abc')).toBeNull();
    expect(userFromAuthorization(undefined)).toBeNull();
  });
});

describe('createServer', () => {
  const mint = vi.fn(
    async (userId: string, prefill: Record<string, unknown>) => ({
      url: `https://forms.example/${userId}/${Object.keys(prefill).length}`,
      instanceId: 'i-1',
    }),
  );

  it('serves the mutation over HTTP for an authenticated caller', async () => {
    const { server, start } = createServer(mint);
    const { url } = await start(0);
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: 'Bearer user-1',
        },
        body: JSON.stringify({ query: MUTATION, variables: { units: 10 } }),
      });
      expect(await response.json()).toEqual({
        data: {
          investSigningUrl: {
            url: 'https://forms.example/user-1/5',
            instanceId: 'i-1',
          },
        },
      });
      expect(mint).toHaveBeenCalledWith(
        'user-1',
        expect.objectContaining({
          number_of_units: '10',
          total_subscription_usd: '1000.00',
        }),
      );
    } finally {
      await server.stop();
    }
  });

  it('answers with errors, not a mint, for an unauthenticated caller or bad units', async () => {
    const { server, start } = createServer(mint);
    const { url } = await start(0);
    mint.mockClear();
    try {
      const post = (headers: Record<string, string>, units: number) =>
        fetch(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json', ...headers },
          body: JSON.stringify({ query: MUTATION, variables: { units } }),
        }).then(r => r.json());
      const anonymous = await post({}, 10);
      expect(anonymous.errors[0].message).toBe('Unauthenticated');
      const tooMany = await post({ authorization: 'Bearer user-1' }, 999_999);
      expect(tooMany.errors[0].message).toMatch(/units must be/);
      expect(mint).not.toHaveBeenCalled();
      const health = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ query: '{ health }' }),
      }).then(r => r.json());
      expect(health).toEqual({ data: { health: 'ok' } });
    } finally {
      await server.stop();
    }
  });

  it('serves the return-URL bridge, which posts the outcome DocuSign sent back', async () => {
    const { server, start } = createServer(mint);
    const { url } = await start(0);
    try {
      const complete = await fetch(
        `${url}signing/return?event=signing_complete`,
      );
      expect(complete.headers.get('content-type')).toMatch(/text\/html/);
      // The package's CSP: the inline script is allowed by nonce only, and
      // the page may be framed by the app (frame-ancestors *)
      const csp = complete.headers.get('content-security-policy') ?? '';
      const nonce = /script-src 'nonce-([^']+)'/.exec(csp)?.[1];
      expect(nonce).toBeTruthy();
      expect(csp).toContain("default-src 'none'");
      expect(csp).toContain('frame-ancestors *');
      const html = await complete.text();
      expect(html).toContain(`<script nonce="${nonce}">`);
      expect(html).toContain('signing_complete');
      // No event (or a non-string one) still renders the bridge
      const none = await fetch(`${url}signing/return?event=a&event=b`);
      expect(none.status).toBe(200);
    } finally {
      await server.stop();
    }
  });

  it('serves the REST spelling of the same mint: POST /webform/instance, locked the same way as the mutation', async () => {
    const { server, start } = createServer(mint);
    const { url } = await start(0);
    mint.mockClear();
    try {
      const response = await fetch(`${url}webform/instance`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: 'Bearer user-1',
        },
        // The client's number_of_units is intent, not fact: the mint is
        // still asked for the computed prefill (total, rate), not this body
        body: JSON.stringify({ prefill: { number_of_units: '10' } }),
      });
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        url: 'https://forms.example/user-1/5',
        instanceId: 'i-1',
      });
      expect(mint).toHaveBeenCalledWith(
        'user-1',
        expect.objectContaining({
          number_of_units: '10',
          total_subscription_usd: '1000.00',
        }),
      );
    } finally {
      await server.stop();
    }
  });

  it('POST /webform/instance refuses an unauthenticated caller (401, no mint)', async () => {
    const { server, start } = createServer(mint);
    const { url } = await start(0);
    mint.mockClear();
    try {
      const response = await fetch(`${url}webform/instance`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ prefill: { number_of_units: '10' } }),
      });
      expect(response.status).toBe(401);
      expect(mint).not.toHaveBeenCalled();
    } finally {
      await server.stop();
    }
  });

  it.each([
    ['non-numeric', 'abc'],
    ['negative', '-1'],
    ['zero', '0'],
    ['fractional', '1.5'],
    ['huge', '999999'],
    ['missing', undefined],
  ])(
    'POST /webform/instance answers 400 with a message for %s number_of_units, never the mint',
    async (_label, value) => {
      const { server, start } = createServer(mint);
      const { url } = await start(0);
      mint.mockClear();
      try {
        const response = await fetch(`${url}webform/instance`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: 'Bearer user-1',
          },
          body: JSON.stringify({
            prefill: value === undefined ? {} : { number_of_units: value },
          }),
        });
        expect(response.status).toBe(400);
        expect((await response.json()).error).toMatch(/units must be/);
        expect(mint).not.toHaveBeenCalled();
      } finally {
        await server.stop();
      }
    },
  );

  it('POST /webform/instance still answers 502 when the mint itself fails (a real provider/network failure)', async () => {
    const failingMint = vi.fn().mockRejectedValue(new Error('network down'));
    const { server, start } = createServer(failingMint, { logger: silent });
    const { url } = await start(0);
    try {
      const response = await fetch(`${url}webform/instance`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: 'Bearer user-1',
        },
        body: JSON.stringify({ prefill: { number_of_units: '10' } }),
      });
      expect(response.status).toBe(502);
    } finally {
      await server.stop();
    }
  });

  it('GET /health answers ok (the CI smoke and the container HEALTHCHECK hit this)', async () => {
    const { server, start } = createServer(mint);
    const { url } = await start(0);
    try {
      const response = await fetch(`${url}health`);
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ status: 'ok' });
    } finally {
      await server.stop();
    }
  });
});
