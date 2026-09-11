// The service as one Fetch handler: `createESignApp(env) → { fetch }`.
//
// Everything a deployment does is decided here, from the environment alone:
// the boot guard runs once at construction (so a misconfigured function fails
// at first import, exactly as a container fails at boot), the capabilities
// decide which routes exist, and the routes themselves are the package's
// presets - createHostedFormApp for the mint half, and, only when
// DATABASE_URL turned envelopes on, this service's Fetch webhook + GraphQL
// handlers, reached through the loader its entry supplied.
//
// Node-only pieces (Apollo, Knex, `pg`) are reachable only through the
// `loadEnvelopes` loader an entry hands in - this module never names
// ./envelopes, so a bundler following the Cloudflare entry cannot reach them
// either.
//
// The host's two obligations are the two hooks:
//   - session verification (JWKS or a shared secret) turns the caller's
//     bearer token into the user id the mint locks the instance to
//   - TERMS_URL computes what is actually minted, so a client value can
//     never become a locked one

import { bearerToken, createHostedFormApp } from '@blinkbitcoin/esign-node';

import { type Capability, ENVELOPES, mockPagesEnabled } from './capabilities';
import { ESIGN_ENV, getAllowedOrigins, type Runtime, validateConfig } from './config';
import type { Env } from './env';
import type { LoadEnvelopes } from './envelopes';
import { type MockPrefillLookup, selectProvider } from './providers';
import { mockPageResponse } from './providers/pages';
import type { ESignProvider } from './providers/port';
import { trustsProxy } from './proxy';
import { sessionVerifierFromEnv } from './session';
import { createTermsPrefill, TERMS_FAILURE_MESSAGE, termsConfigFromEnv } from './terms';

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
  // The fetch the TERMS_URL callback uses (default: the platform's)
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

// The terms callback failed for this request. The mint's own error contract
// (@blinkbitcoin/esign-node) maps an unrecognized throw to a generic 502, so
// the reason is carried out here and the answer is rewritten with it: the
// terms could not be computed, which is not a signing failure.
const termsFailures = new WeakSet<Request>();

export const createESignApp = (env: Env = process.env, deps: ESignAppDeps = {}): ESignApp => {
  // Fail closed before anything is constructed: one message, every problem,
  // and the capabilities that were on.
  const capabilities = validateConfig(env, { runtime: deps.runtime });

  const selected = deps.provider
    ? { provider: deps.provider, mockPrefill: deps.mockPrefill }
    : selectProvider(env);
  const provider = selected.provider;
  const verify = sessionVerifierFromEnv(env);
  const origins = getAllowedOrigins(env);
  const terms = termsConfigFromEnv(env);
  const mockPages = mockPagesEnabled(env);

  const authenticate = (request: Request): Promise<string | null> =>
    verify(bearerToken(request.headers.get('authorization') ?? undefined) ?? '');

  const lockedPrefill = terms ? createTermsPrefill(terms, { fetch: deps.fetch }) : undefined;

  // The mint half: POST /webform/instance, the return-URL bridge, the CORS
  // preflight. /health is this app's own (it reports the capabilities).
  const hostedForm = createHostedFormApp({
    provider,
    authenticate,
    health: false,
    ...(origins.length > 0 ? { cors: { origins } } : {}),
    ...(lockedPrefill
      ? {
          prefill: async (input) => {
            try {
              return await lockedPrefill(input);
            } catch (error) {
              termsFailures.add(input.request);
              throw error;
            }
          },
        }
      : {}),
  });

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
      introspection: env[ESIGN_ENV] !== 'production',
      trustProxy: trustsProxy(env),
    })
  );
  // A failure surfaces on the first request that needs the capability; this
  // only marks the promise handled so it is not an unhandled rejection
  envelopes?.catch(() => undefined);

  const route = async (request: Request, url: URL): Promise<Response> => {
    if (request.method === 'GET' && url.pathname === HEALTH_PATH) {
      return json({ status: 'ok', capabilities, timestamp: new Date().toISOString() });
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

    return hostedForm.fetch(request);
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

      if (response.status === 502 && termsFailures.has(request)) {
        return withDefaults(json({ error: TERMS_FAILURE_MESSAGE }, 502, cors), SECURITY_HEADERS);
      }

      return withDefaults(withDefaults(response, cors), SECURITY_HEADERS);
    },
  };
};
