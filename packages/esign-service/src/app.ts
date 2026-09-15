// The service as one Fetch handler: `createESignApp(env) → { fetch }`.
//
// Everything a deployment does is decided here, from the environment alone:
// the boot guard runs once at construction (so a misconfigured function fails
// at first import, exactly as a container fails at boot), the capabilities
// decide which routes exist, and the routes themselves are the package's
// presets - the mint mode's (mint.ts: a Web Form, or an envelope under
// ESIGN_MINT_MODE=envelope) for the mint half, and, only when DATABASE_URL
// turned envelopes on, this service's Fetch webhook + GraphQL handlers,
// reached through the loader its entry supplied.
//
// Node-only pieces (Apollo, Knex, `pg`) are reachable only through the
// `loadEnvelopes` loader an entry hands in - this module never names
// ./envelopes, so a bundler following the Cloudflare entry cannot reach them
// either.
//
// The host's two obligations are the two hooks:
//   - session verification (JWKS or a shared secret) turns the caller's
//     bearer token into the user id the mint locks the instance to
//   - ESIGN_PREFILL_URL computes what is actually minted (for an envelope, who signs
//     it too), so a client value can never become a locked one unless the
//     deployment opts in with ESIGN_ALLOW_CLIENT_PREFILL

import { bearerToken, consoleLogger, type Logger } from '@blinkbitcoin/esign-node';

import { type Capability, ENVELOPES, mockPagesEnabled } from './capabilities';
import { getAllowedOrigins, type Runtime, validateConfig } from './config';

// Apollo's schema discovery. Off unless asked for: a deployment that wants
// it says so, rather than it following from how the environment is labelled.
export const ESIGN_GRAPHQL_INTROSPECTION = 'ESIGN_GRAPHQL_INTROSPECTION';

import type { Env } from './env';
import type { LoadEnvelopes } from './envelopes';
import { isPrefillFailure, mintModeFromEnv } from './mint';
import { PREFILL_FAILURE_MESSAGE, prefillConfigFromEnv } from './prefill';
import { type MockPrefillLookup, selectProvider } from './providers';
import { mockPageResponse } from './providers/pages';
import type { ESignProvider } from './providers/port';
import { trustsProxy } from './proxy';
import { sessionVerifierFromEnv } from './session';

const HEALTH_PATH = '/health';
const WEBHOOK_PATH = '/webhook/esign';
const GRAPHQL_PATH = '/graphql';

// The baseline security headers. Helmet is Express-only, so the equivalents
// are set here - on every response that does not carry its own policy. The
// signing pages bring a nonce-based CSP from the package and keep it.
export const SECURITY_HEADERS: Record<string, string> = {
  'content-security-policy': "default-src 'none';frame-ancestors 'none'",
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'no-referrer',
  'cross-origin-resource-policy': 'same-origin',
  'strict-transport-security': 'max-age=15552000; includeSubDomains',
};

export interface ESignAppDeps {
  // Where the boot banner goes (default: the console). Injected so tests
  // stay silent and so a host can route it into its own logging.
  logger?: Logger;
  // The provider to mint with (default: ESIGN_PROVIDER over this service's
  // registry)
  provider?: ESignProvider;
  // What a minted instance locked, when `provider` is the mock: the mock
  // signing pages render it (selectProvider returns the pair together)
  mockPrefill?: MockPrefillLookup;
  // How the Node-only envelope module is reached. An entry that can serve
  // envelopes passes `() => import('./envelopes.js')`; the Cloudflare entry
  // passes nothing, and a DATABASE_URL it cannot honour is a boot error.
  loadEnvelopes?: LoadEnvelopes;
  // The fetch the ESIGN_PREFILL_URL callback uses (default: the platform's)
  fetch?: typeof globalThis.fetch;
  // The target this app runs on (default 'node'); the boot guard refuses a
  // configuration the runtime cannot serve
  runtime?: Runtime;
}

export interface ESignApp {
  fetch: (request: Request) => Promise<Response>;
  // What this deployment serves, as /health reports it
  capabilities: Capability[];
  // Drain: stops the GraphQL server when envelopes are on
  stop: () => Promise<void>;
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });

// The allowed origin echoed back, and the Vary that keeps a shared cache
// from serving one origin's answer to another
export const corsHeaders = (origins: string[], request: Request): Record<string, string> => {
  if (origins.length === 0) {
    return {};
  }
  const vary = { vary: 'origin' };
  const origin = request.headers.get('origin');
  if (!origin) {
    return vary;
  }
  if (origins.includes('*')) {
    return { ...vary, 'access-control-allow-origin': '*' };
  }
  return origins.includes(origin) ? { ...vary, 'access-control-allow-origin': origin } : vary;
};

// Set what the response does not already say for itself
export const withDefaults = (response: Response, headers: Record<string, string>): Response => {
  for (const [key, value] of Object.entries(headers)) {
    if (!response.headers.has(key)) {
      response.headers.set(key, value);
    }
  }
  return response;
};

export const createESignApp = (env: Env = process.env, deps: ESignAppDeps = {}): ESignApp => {
  // Fail closed before anything is constructed: one message, every problem,
  // and the capabilities that were on.
  const capabilities = validateConfig(env, { runtime: deps.runtime, logger: deps.logger });

  const selected = deps.provider
    ? { provider: deps.provider, mockPrefill: deps.mockPrefill }
    : selectProvider(env);
  const provider = selected.provider;
  const verify = sessionVerifierFromEnv(env, deps.logger ?? consoleLogger);
  const origins = getAllowedOrigins(env);
  const terms = prefillConfigFromEnv(env);
  const mockPages = mockPagesEnabled(env);
  const mode = mintModeFromEnv(env);

  const authenticate = (request: Request): Promise<string | null> =>
    verify(bearerToken(request.headers.get('authorization') ?? undefined) ?? '');

  // Envelope orchestration, built once and only when it is on, through the
  // loader the entry supplied. A target without one cannot serve the
  // capability at all, and saying so at construction beats 404ing the routes
  // the environment asked for.
  const load = capabilities.includes(ENVELOPES) ? deps.loadEnvelopes : undefined;
  if (capabilities.includes(ENVELOPES) && !load) {
    throw new Error(
      'Refusing to start: DATABASE_URL asks for envelope orchestration, but this target was built without the envelope module. Deploy the container, or @blinkbitcoin/esign-service/node'
    );
  }
  const envelopes = load?.().then((module) =>
    module.createEnvelopeCapability({
      env,
      provider,
      authenticate,
      introspection: env[ESIGN_GRAPHQL_INTROSPECTION] === 'true',
      trustProxy: trustsProxy(env),
    })
  );
  // A failure surfaces on the first request that needs the capability; this
  // only marks the promise handled so it is not an unhandled rejection
  envelopes?.catch(() => undefined);

  // The envelope domain, for a mint that creates through it: the same
  // capability, so its failure surfaces on the first mint that needs it and,
  // like the capability's, is only marked handled here
  const domain = envelopes?.then((capability) => capability.envelopes);
  domain?.catch(() => undefined);

  // The mint half: the mode's endpoint with the return-URL bridge and the CORS
  // preflight around it. /health is this app's own (it reports the
  // capabilities).
  const mint = mode.createApp({
    provider,
    authenticate,
    origins,
    terms,
    fetch: deps.fetch,
    envelopes: domain,
  });

  const route = async (request: Request, url: URL): Promise<Response> => {
    if (request.method === 'GET' && url.pathname === HEALTH_PATH) {
      return json({
        status: 'ok',
        capabilities,
        mint: mode.name,
        timestamp: new Date().toISOString(),
      });
    }

    if (envelopes && url.pathname === WEBHOOK_PATH && request.method === 'POST') {
      return (await envelopes).webhook(request);
    }

    if (envelopes && url.pathname === GRAPHQL_PATH) {
      return (await envelopes).graphql(request);
    }

    if (mockPages) {
      const page = mockPageResponse(url, selected.mockPrefill);
      if (page) {
        return page;
      }
    }

    return mint.fetch(request);
  };

  return {
    capabilities,
    stop: async () => {
      await (await envelopes)?.stop();
    },
    fetch: async (request) => {
      const url = new URL(request.url);
      const cors = corsHeaders(origins, request);

      // The mint's preflight is the hosted-form app's; this one is for the
      // GraphQL endpoint the browser demos call cross-origin.
      if (request.method === 'OPTIONS' && url.pathname === GRAPHQL_PATH) {
        return new Response(null, {
          status: 204,
          headers: {
            ...cors,
            'access-control-allow-methods': 'POST, OPTIONS',
            'access-control-allow-headers': 'authorization, content-type',
            'access-control-max-age': '86400',
          },
        });
      }

      const response = await route(request, url);

      if (response.status === 502 && isPrefillFailure(request)) {
        return withDefaults(json({ error: PREFILL_FAILURE_MESSAGE }, 502, cors), SECURITY_HEADERS);
      }

      return withDefaults(withDefaults(response, cors), SECURITY_HEADERS);
    },
  };
};
