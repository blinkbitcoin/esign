// Driving the Fetch core in tests: build an app from an explicit environment
// and call it with real Request objects (no HTTP server, no supertest).

import { vi } from 'vitest';

import { createESignApp, type ESignAppDeps } from '../../src/app';
import type { Env } from '../../src/env';

// The environment a local/dev deployment runs with: no session source (the
// bearer token IS the user id) and the mock provider, mint only. Nothing
// opts into that any more - it is what an unconfigured deployment does.
export const DEV_ENV: Env = { ESIGN_PROVIDER: 'mock' };

// The boot banner every app prints, sunk so the suite stays silent. Tests
// that assert on the banner pass their own logger instead.
export const silentLogger = () => ({ log: vi.fn(), warn: vi.fn(), error: vi.fn() });

// How the Node targets reach the envelope module; the tests are a Node
// target too, so they hand in the same loader
export const loadEnvelopes = () => import('../../src/envelopes');

// Run `body` with the console silenced, for a single expression that logs
// (a boot warning, an import that builds its app)
export const silently = async <T>(run: () => T | Promise<T>): Promise<T> => {
  const spies = (['log', 'warn', 'error'] as const).map((method) =>
    vi.spyOn(console, method).mockImplementation(() => {})
  );
  try {
    return await run();
  } finally {
    for (const spy of spies) {
      spy.mockRestore();
    }
  }
};

// An app for `env`, with the boot banner sunk into a spy logger so test
// output stays clean (the banner itself is asserted in posture.test.ts and
// config.test.ts, which pass their own)
export const testApp = (env: Env = {}, deps: ESignAppDeps = {}) =>
  createESignApp({ ...DEV_ENV, ...env }, { loadEnvelopes, logger: silentLogger(), ...deps });

// The same app with envelope orchestration on (the store is mocked by the
// suite that asks for it)
export const testFullApp = (env: Env = {}, deps: ESignAppDeps = {}) =>
  testApp({ DATABASE_URL: 'postgresql://test:test@localhost:5433/esign_test', ...env }, deps);

type App = { fetch: (request: Request) => Promise<Response> };

const url = (path: string) => new URL(path, 'http://localhost:4000').toString();

export const get = (app: App, path: string, headers: HeadersInit = {}): Promise<Response> =>
  app.fetch(new Request(url(path), { headers }));

export const options = (app: App, path: string, headers: HeadersInit = {}): Promise<Response> =>
  app.fetch(new Request(url(path), { method: 'OPTIONS', headers }));

// POST a JSON body (an object is serialized; a string is sent verbatim, so a
// signature over the exact bytes still matches)
export const post = (
  app: App,
  path: string,
  body?: unknown,
  headers: HeadersInit = {}
): Promise<Response> =>
  app.fetch(
    new Request(url(path), {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...Object.fromEntries(new Headers(headers)) },
      ...(body === undefined
        ? {}
        : { body: typeof body === 'string' ? body : JSON.stringify(body) }),
    })
  );

export const asJson = async <T = Record<string, unknown>>(response: Response): Promise<T> =>
  (await response.json()) as T;

export interface GraphQLResult<T> {
  data?: T;
  errors?: { message: string; extensions?: { code?: string } }[];
}

// A GraphQL operation through the app under test: the real /graphql route,
// over the app's own executor, provider and store. Never a second Apollo
// server built beside it - a suite that composed its own would be proving
// the domain, not the service's wiring. With no session source configured -
// what these suites and the E2E .env.test run on - the bearer token IS the
// user id, which is how a caller is chosen here.
export const graphql = async <T = Record<string, unknown>>(
  app: App,
  query: string,
  variables: Record<string, unknown> = {},
  userId?: string
): Promise<GraphQLResult<T>> =>
  asJson<GraphQLResult<T>>(
    await post(
      app,
      '/graphql',
      { query, variables },
      userId === undefined ? {} : { authorization: `Bearer ${userId}` }
    )
  );

// The app exactly as this process is configured (the E2E suites run against
// a real Postgres from .env.test, so the environment is already right).
// process.env itself, not a copy: those suites set DOCUSIGN_HMAC_KEY per
// test, and the adapter reads the env object it was handed on every call.
export const envApp = (deps: ESignAppDeps = {}) => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  try {
    return createESignApp(process.env, { loadEnvelopes, ...deps });
  } finally {
    warn.mockRestore();
  }
};
