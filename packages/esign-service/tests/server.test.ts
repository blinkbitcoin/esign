// The Node server: rate limits, the proxy-aware client key, and the SIGTERM
// drain. Port 0 so the OS assigns an ephemeral port - no collisions, no mocks.

import { vi } from 'vitest';

import {
  createRateLimiter,
  DEFAULT_RATE_LIMITS,
  rateLimitsFromEnv,
  RATE_LIMIT_MAX_WINDOWS,
  type RateWindow,
  type RunningServer,
  shutdown,
  sweepWindows,
  startServer,
} from '../src/server';
import { DEV_ENV } from './support/app';

describe('rateLimitsFromEnv', () => {
  it('defaults to what the Express limiters allowed', () => {
    expect(rateLimitsFromEnv({})).toEqual(DEFAULT_RATE_LIMITS);
  });

  it('reads RATE_LIMIT_*_PER_MIN', () => {
    expect(
      rateLimitsFromEnv({
        RATE_LIMIT_WEBFORM_PER_MIN: '5',
        RATE_LIMIT_WEBHOOK_PER_MIN: '6',
        RATE_LIMIT_GRAPHQL_PER_MIN: '7',
      })
    ).toEqual({ webform: 5, webhook: 6, graphql: 7 });
  });

  it('ignores a value that is not a number or is negative', () => {
    expect(
      rateLimitsFromEnv({ RATE_LIMIT_WEBFORM_PER_MIN: 'lots', RATE_LIMIT_WEBHOOK_PER_MIN: '-1' })
    ).toEqual(DEFAULT_RATE_LIMITS);
  });
});

describe('sweepWindows', () => {
  const windowsOf = (entries: [string, RateWindow][]) => new Map<string, RateWindow>(entries);

  it('drops the windows that have elapsed and keeps the live ones', () => {
    const windows = windowsOf([
      ['graphql:a', { count: 3, resetAt: 500 }],
      ['graphql:b', { count: 1, resetAt: 2_000 }],
      ['webhook:a', { count: 9, resetAt: 1_000 }],
    ]);

    sweepWindows(windows, 1_000);

    expect([...windows.keys()]).toEqual(['graphql:b']);
  });

  it('keeps the map under the cap even when every window is live', () => {
    const windows = windowsOf(
      Array.from({ length: 6 }, (_, i) => [`graphql:${i}`, { count: 1, resetAt: 10_000 }])
    );

    sweepWindows(windows, 1_000, 4);

    // The oldest (first inserted, so closest to expiring) go first
    expect(windows.size).toBe(3);
    expect([...windows.keys()]).toEqual(['graphql:3', 'graphql:4', 'graphql:5']);
  });

  it('leaves a map under the cap alone', () => {
    const windows = windowsOf([['graphql:a', { count: 1, resetAt: 10_000 }]]);

    sweepWindows(windows, 1_000, 4);

    expect(windows.size).toBe(1);
  });
});

describe('createRateLimiter', () => {
  const limits = { webform: 2, webhook: 2, graphql: 2 };

  it('does not limit routes outside the three API endpoints', () => {
    const limiter = createRateLimiter(limits);
    expect(limiter('/health', 'ip')).toBeUndefined();
    expect(limiter('/signing/return', 'ip')).toBeUndefined();
  });

  it('limits each API route', () => {
    const limiter = createRateLimiter(limits);
    for (const path of ['/webform/instance', '/webhook/esign', '/graphql']) {
      expect(limiter(path, 'ip')?.allowed).toBe(true);
      expect(limiter(path, 'ip')?.allowed).toBe(true);
      expect(limiter(path, 'ip')?.allowed).toBe(false);
    }
  });

  it('counts each client separately', () => {
    const limiter = createRateLimiter(limits);
    limiter('/graphql', 'a');
    limiter('/graphql', 'a');

    expect(limiter('/graphql', 'a')?.allowed).toBe(false);
    expect(limiter('/graphql', 'b')?.allowed).toBe(true);
  });

  it('reports what is left and when the window resets', () => {
    let now = 1_000;
    const limiter = createRateLimiter(limits, () => now);

    expect(limiter('/graphql', 'a')).toEqual({
      allowed: true,
      limit: 2,
      remaining: 1,
      resetSeconds: 60,
    });

    now += 30_000;
    expect(limiter('/graphql', 'a')).toEqual({
      allowed: true,
      limit: 2,
      remaining: 0,
      resetSeconds: 30,
    });

    now += 30_000;
    // The window elapsed: the count starts over
    expect(limiter('/graphql', 'a')?.remaining).toBe(1);
  });

  it('does not grow without bound when every client is new', () => {
    // A flood from many source addresses: the limiter sweeps at the cap, so
    // the windows it keeps stay bounded rather than one per address forever
    let now = 1_000;
    const limiter = createRateLimiter({ webform: 1, webhook: 1, graphql: 1 }, () => now);

    for (let i = 0; i < RATE_LIMIT_MAX_WINDOWS + 100; i += 1) {
      // Half the clients' windows have elapsed by the time the cap is hit
      if (i === RATE_LIMIT_MAX_WINDOWS / 2) {
        now += 61_000;
      }
      limiter('/graphql', `client-${i}`);
    }

    // The one that came last still gets its own fresh window
    expect(limiter('/graphql', 'client-last')?.remaining).toBe(0);
  });

  it('is off for a route whose limit is 0', () => {
    const limiter = createRateLimiter({ ...limits, graphql: 0 });
    for (let i = 0; i < 5; i += 1) {
      expect(limiter('/graphql', 'a')).toBeUndefined();
    }
  });
});

describe('shutdown', () => {
  it('reports a failure instead of throwing at a signal handler', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(
      shutdown(async () => {
        throw new Error('still draining');
      })
    ).resolves.toBeUndefined();
    expect(error).toHaveBeenCalledWith('Shutdown failed:', expect.any(Error));

    error.mockRestore();
  });

  it('is silent when the close succeeds', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});

    await shutdown(async () => undefined);

    expect(error).not.toHaveBeenCalled();
    error.mockRestore();
  });
});

describe('startServer', () => {
  let server: RunningServer | undefined;
  let logs: ReturnType<typeof vi.spyOn>;
  let warns: ReturnType<typeof vi.spyOn>;

  const start = (
    env: Record<string, string | undefined> = {},
    deps: Parameters<typeof startServer>[1] = {}
  ) => startServer({ ...DEV_ENV, PORT: '0', ...env }, deps);

  beforeEach(() => {
    logs = vi.spyOn(console, 'log').mockImplementation(() => {});
    warns = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(async () => {
    await server?.stop();
    server = undefined;
    logs.mockRestore();
    warns.mockRestore();
  });

  it('listens and serves the health endpoint with its capabilities', async () => {
    server = await start();

    const response = await fetch(`${server.url}/health`);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: 'ok', capabilities: ['mint'] });
  });

  it('logs where it is listening and which provider it runs', async () => {
    server = await start();

    expect(logs).toHaveBeenCalledWith(expect.stringContaining(`${server.url}/health`));
    expect(logs).toHaveBeenCalledWith(expect.stringContaining('E-signature provider: mock'));
  });

  it('defaults the logged provider to mock when ESIGN_PROVIDER is unset', async () => {
    server = await start({ ESIGN_PROVIDER: undefined });

    expect(logs).toHaveBeenCalledWith(expect.stringContaining('E-signature provider: mock'));
  });

  it('answers 429 once a route is over its limit, and marks every answer', async () => {
    server = await start({ RATE_LIMIT_WEBFORM_PER_MIN: '2' });
    const mint = () =>
      fetch(`${server?.url}/webform/instance`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: 'Bearer user-1' },
        body: JSON.stringify({ prefill: {} }),
      });

    const first = await mint();
    expect(first.status).toBe(200);
    expect(first.headers.get('ratelimit')).toContain('limit=2');

    expect((await mint()).status).toBe(200);

    const limited = await mint();
    expect(limited.status).toBe(429);
    expect(await limited.json()).toEqual({ error: 'Too many requests' });
    expect(limited.headers.get('retry-after')).toBeTruthy();
  });

  it('gives the 429 the same security headers as every other JSON answer', async () => {
    server = await start({ RATE_LIMIT_WEBFORM_PER_MIN: '1' });
    const mint = () =>
      fetch(`${server?.url}/webform/instance`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: 'Bearer user-1' },
        body: JSON.stringify({ prefill: {} }),
      });

    const allowed = await mint();
    const limited = await mint();
    expect(limited.status).toBe(429);

    // The limiter answers before the app is reached, so this is the one
    // response the Node target writes itself - it must not be the one that
    // ships without a CSP
    for (const header of [
      'content-security-policy',
      'x-content-type-options',
      'x-frame-options',
      'referrer-policy',
      'cross-origin-resource-policy',
      'strict-transport-security',
    ]) {
      expect(limited.headers.get(header)).toBe(allowed.headers.get(header));
      expect(limited.headers.get(header)).toBeTruthy();
    }
  });

  it('gives the 429 the same CORS answer as every other JSON answer', async () => {
    server = await start({
      RATE_LIMIT_WEBFORM_PER_MIN: '1',
      CORS_ALLOWED_ORIGINS: 'https://app.example.com',
    });
    const mint = () =>
      fetch(`${server?.url}/webform/instance`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: 'Bearer user-1',
          origin: 'https://app.example.com',
        },
        body: JSON.stringify({ prefill: {} }),
      });

    await mint();
    const limited = await mint();

    expect(limited.status).toBe(429);
    expect(limited.headers.get('access-control-allow-origin')).toBe('https://app.example.com');
    expect(limited.headers.get('vary')).toBe('origin');
  });

  it('leaves unlimited routes unmarked', async () => {
    server = await start();

    const response = await fetch(`${server.url}/health`);
    expect(response.headers.get('ratelimit')).toBeNull();
  });

  it('keys the limit on the forwarded client when TRUST_PROXY is set', async () => {
    server = await start({ TRUST_PROXY: 'true', RATE_LIMIT_GRAPHQL_PER_MIN: '1' });
    const call = (client: string) =>
      fetch(`${server?.url}/graphql`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-forwarded-for': `${client}, 10.0.0.1` },
        body: JSON.stringify({ query: '{ __typename }' }),
      });

    // Without the capability the route is 404, but the limiter still counts
    expect((await call('203.0.113.1')).status).not.toBe(429);
    expect((await call('203.0.113.1')).status).toBe(429);
    // A different client has its own window
    expect((await call('203.0.113.2')).status).not.toBe(429);
  });

  it('ignores the forwarded header without TRUST_PROXY', async () => {
    server = await start({ RATE_LIMIT_GRAPHQL_PER_MIN: '1' });
    const call = (client: string) =>
      fetch(`${server?.url}/graphql`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-forwarded-for': client },
        body: JSON.stringify({ query: '{ __typename }' }),
      });

    await call('203.0.113.1');
    // Same socket, so a forged forwarded header buys nothing
    expect((await call('203.0.113.2')).status).toBe(429);
  });

  it('falls back to an unknown client when the platform reports no address', async () => {
    server = await start(
      {
        RATE_LIMIT_GRAPHQL_PER_MIN: '1',
      },
      { clientAddress: () => undefined }
    );
    const call = () =>
      fetch(`${server?.url}/graphql`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ query: '{ __typename }' }),
      });

    await call();
    // Everything shares the one 'unknown' window
    expect((await call()).status).toBe(429);
  });

  it('reports a failure to close (a second stop finds no server)', async () => {
    const running = await start();

    await running.stop();
    await expect(running.stop()).rejects.toThrow();
  });

  it('drains on SIGTERM', async () => {
    const running = await start();

    process.emit('SIGTERM');
    // The listener closes asynchronously
    await vi.waitFor(async () => {
      await expect(fetch(`${running.url}/health`)).rejects.toThrow();
    });
  });

  it('refuses to listen when the configuration is wrong', async () => {
    await expect(startServer({ ESIGN_PROVIDER: 'mock', PORT: '0' })).rejects.toThrow(
      /Refusing to start/
    );
  });
});
