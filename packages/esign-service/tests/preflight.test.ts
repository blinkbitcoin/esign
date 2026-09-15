// Preflight: the difference between a URL set correctly and a URL set
// plausibly. Everything here is a mistake that used to boot clean and fail
// later with no reason given.

import { vi } from 'vitest';

import { formatProbes, preflight } from '../src/preflight';

const JWKS_URL = 'https://id.example.com/.well-known/jwks.json';
const PREFILL_URL = 'https://api.example.com/esign/prefill';

const jwksEnv = { ESIGN_PROVIDER: 'mock', ESIGN_SESSION_JWKS_URL: JWKS_URL };
const prefillEnv = { ESIGN_PROVIDER: 'mock', ESIGN_PREFILL_URL: PREFILL_URL };

const answering = (body: unknown, init: ResponseInit = {}) =>
  vi.fn(async () => new Response(JSON.stringify(body), { status: 200, ...init }));

const throwing = (message: string) =>
  vi.fn(async () => {
    throw new Error(message);
  });

const key = (alg = 'RS256') => ({ kid: `k-${alg}`, alg, kty: 'RSA', use: 'sig' });

describe('preflight', () => {
  // An unset variable is a choice the banner already reported, not a failure
  it('probes nothing when no URL is configured', async () => {
    expect(await preflight({ ESIGN_PROVIDER: 'mock' })).toEqual([]);
  });

  describe('the key set', () => {
    it('reports the key count, the host and the algorithms', async () => {
      expect(await preflight(jwksEnv, { fetch: answering({ keys: [key(), key()] }) })).toEqual([
        { check: 'session', ok: true, detail: '2 keys from id.example.com (RS256)' },
      ]);
    });

    it('counts one key in the singular', async () => {
      const [probe] = await preflight(jwksEnv, { fetch: answering({ keys: [key()] }) });
      expect(probe.detail).toContain('1 key from');
    });

    it('lists every algorithm the set offers', async () => {
      const [probe] = await preflight(jwksEnv, {
        fetch: answering({ keys: [key('RS256'), key('ES256')] }),
      });
      expect(probe.detail).toContain('(RS256, ES256)');
    });

    it('omits the algorithms when the keys declare none', async () => {
      const [probe] = await preflight(jwksEnv, { fetch: answering({ keys: [{ kid: 'k' }] }) });
      expect(probe).toEqual({ check: 'session', ok: true, detail: '1 key from id.example.com' });
    });

    // The typo case: the whole reason this exists
    it('reports a host that does not resolve, without throwing', async () => {
      const [probe] = await preflight(jwksEnv, {
        fetch: throwing('getaddrinfo ENOTFOUND id.exmaple.com'),
      });
      expect(probe).toMatchObject({ check: 'session', ok: false });
      expect(probe.detail).toContain('ENOTFOUND');
    });

    it('reports a non-2xx answer', async () => {
      const [probe] = await preflight(jwksEnv, {
        fetch: vi.fn(async () => new Response('nope', { status: 404 })),
      });
      expect(probe).toEqual({
        check: 'session',
        ok: false,
        detail: 'id.example.com answered 404',
      });
    });

    it('reports a body that is not JSON', async () => {
      const [probe] = await preflight(jwksEnv, {
        fetch: vi.fn(async () => new Response('<html>hello</html>', { status: 200 })),
      });
      expect(probe.detail).toContain('did not answer with JSON');
    });

    it('reports a key set with no keys', async () => {
      const [probe] = await preflight(jwksEnv, { fetch: answering({ keys: [] }) });
      expect(probe).toMatchObject({ ok: false, detail: expect.stringContaining('no keys') });
    });

    it('reports a JSON document that is not a key set at all', async () => {
      const [probe] = await preflight(jwksEnv, { fetch: answering({ message: 'unauthorized' }) });
      expect(probe).toMatchObject({ ok: false, detail: expect.stringContaining('no keys') });
    });

    // Nothing validates the shape of this URL at boot (unlike the prefill
    // one), so a value that is not a URL at all reaches the probe - and must
    // be reported as itself rather than crash the host extraction
    it('reports a value that is not a URL, verbatim', async () => {
      const [probe] = await preflight(
        { ESIGN_PROVIDER: 'mock', ESIGN_SESSION_JWKS_URL: 'id.example.com/jwks' },
        { fetch: throwing('Failed to parse URL') }
      );
      expect(probe).toEqual({
        check: 'session',
        ok: false,
        detail: 'id.example.com/jwks unreachable: Failed to parse URL',
      });
    });
  });

  // A fetch implementation is not obliged to throw an Error, and a probe
  // that crashed on the way to reporting a failure would be the worst outcome
  it('reports something thrown that is not an Error', async () => {
    const [probe] = await preflight(jwksEnv, {
      fetch: vi.fn(async () => {
        throw 'socket hang up';
      }),
    });
    expect(probe.detail).toContain('socket hang up');
  });

  // The Node target passes no fetch, so the global one is the real path
  it('falls back to the global fetch when none is injected', async () => {
    const global = vi.fn(async () => new Response(JSON.stringify({ keys: [key()] })));
    vi.stubGlobal('fetch', global);
    try {
      const [probe] = await preflight(jwksEnv);
      expect(global).toHaveBeenCalled();
      expect(probe.ok).toBe(true);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  // Deliberately not probed: it is someone else's POST endpoint, and an
  // unexpected request on every boot is a side effect the operator did not
  // ask for. A bodyless HEAD crashed this repo's own demo stub the first
  // time this ran. `check-prefill` verifies it explicitly instead.
  it('never touches the prefill callback', async () => {
    const doFetch = vi.fn(async () => new Response(null, { status: 200 }));

    expect(
      await preflight(
        { ESIGN_PROVIDER: 'mock', ESIGN_PREFILL_URL: PREFILL_URL },
        { fetch: doFetch }
      )
    ).toEqual([]);
    expect(doFetch).not.toHaveBeenCalled();
  });

  it('probes only the key set when both are configured', async () => {
    const probes = await preflight(
      { ...jwksEnv, ...prefillEnv },
      { fetch: answering({ keys: [key()] }) }
    );
    expect(probes.map((probe) => probe.check)).toEqual(['session']);
  });
});

describe('formatProbes', () => {
  it('lines up with the banner rows above it', () => {
    expect(
      formatProbes([{ check: 'session', ok: true, detail: '2 keys from id.example.com' }])
    ).toBe('  session       2 keys from id.example.com');
  });

  // A failed probe has to be findable in a wall of container output
  it('marks a failed probe', () => {
    expect(formatProbes([{ check: 'prefill', ok: false, detail: 'unreachable' }])).toBe(
      '  prefill       ! unreachable'
    );
  });

  it('is empty when nothing was probed', () => {
    expect(formatProbes([])).toBe('');
  });
});
