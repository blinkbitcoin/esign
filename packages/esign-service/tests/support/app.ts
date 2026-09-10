// Driving the Fetch core in tests: build an app from an explicit environment
// and call it with real Request objects (no HTTP server, no supertest).

import { vi } from 'vitest';

import { createESignApp, type ESignAppDeps } from '../../src/app';
import type { Env } from '../../src/env';

// The environment a local/dev deployment runs with: the dev passthrough (the
// bearer token IS the user id) and the mock provider, mint only.
export const DEV_ENV: Env = { ALLOW_INSECURE_DEV: 'true', ESIGN_PROVIDER: 'mock' };

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

// An app for `env`, with the one boot warning ALLOW_INSECURE_DEV prints
// silenced (test output stays clean)
export const testApp = (env: Env = {}, deps: ESignAppDeps = {}) => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  try {
    return createESignApp({ ...DEV_ENV, ...env }, { loadEnvelopes, ...deps });
  } finally {
    warn.mockRestore();
  }
};

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
// the domain, not the service's wiring. Under ALLOW_INSECURE_DEV (what the
// E2E .env.test sets) the bearer token IS the user id, which is how a caller
// is chosen here.
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
