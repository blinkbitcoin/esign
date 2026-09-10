// The container half of the service: the Fetch core behind a Node HTTP
// server, plus the things only a long-lived process needs.
//
// `@hono/node-server` is the Fetch-to-Node bridge and nothing more - there is
// no Hono app, no framework and no middleware chain. What Express used to
// provide is either in the Fetch core (the security headers, CORS, the
// routes) or right here, because it is container-only:
//   - in-memory rate limits per route (a function relies on its platform's)
//   - TRUST_PROXY, so the limiter keys on the real client, not the proxy
//   - a SIGTERM drain
// PORT, the rate limits, TRUST_PROXY and DOCUSIGN_PRIVATE_KEY_FILE are the
// only container-only variables: every other name means the same thing on
// every target.

import type { AddressInfo } from 'node:net';
import { serve } from '@hono/node-server';

import {
  corsHeaders,
  createESignApp,
  type ESignAppDeps,
  SECURITY_HEADERS,
  withDefaults,
} from './app';
import { getAllowedOrigins } from './config';
import type { Env } from './env';
import { loadEnvelopes } from './loadEnvelopes';
import { resolvePort } from './port';
import { forwardedClientIp, trustsProxy } from './proxy';

export { TRUST_PROXY } from './proxy';

// The rate-limit window. Limits are per client, per route, per minute.
export const RATE_LIMIT_WINDOW_MS = 60_000;

export interface RateLimits {
  webform: number;
  webhook: number;
  graphql: number;
}

// What Express's rate limiters allowed, unchanged
export const DEFAULT_RATE_LIMITS: RateLimits = { webform: 60, webhook: 120, graphql: 100 };

const limitFromEnv = (value: string | undefined, fallback: number): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
};

// RATE_LIMIT_*_PER_MIN, one per rate-limited route. 0 switches a route's
// limit off (a deployment behind its own gateway).
export const rateLimitsFromEnv = (env: Env): RateLimits => ({
  webform: limitFromEnv(env.RATE_LIMIT_WEBFORM_PER_MIN, DEFAULT_RATE_LIMITS.webform),
  webhook: limitFromEnv(env.RATE_LIMIT_WEBHOOK_PER_MIN, DEFAULT_RATE_LIMITS.webhook),
  graphql: limitFromEnv(env.RATE_LIMIT_GRAPHQL_PER_MIN, DEFAULT_RATE_LIMITS.graphql),
});

// The rate-limited routes. Everything else (the health check, the signing
// pages) is unlimited: they are cheap and the pages are loaded by the signer
// in a WebView, not by an API client.
const limitedRoute = (pathname: string): keyof RateLimits | undefined => {
  if (pathname === '/webform/instance') {
    return 'webform';
  }
  if (pathname === '/webhook/esign') {
    return 'webhook';
  }
  return pathname === '/graphql' ? 'graphql' : undefined;
};

// How many windows the limiter keeps before it sweeps. A flood from many
// source addresses must not grow the heap without bound.
export const RATE_LIMIT_MAX_WINDOWS = 10_000;

export interface RateWindow {
  count: number;
  resetAt: number;
}

// Drop every window that has already elapsed. If that leaves the map still
// at the cap - a genuine flood of live clients - drop the oldest entries
// too: a Map keeps insertion order, so those are the ones closest to
// expiring anyway.
export const sweepWindows = (
  windows: Map<string, RateWindow>,
  now: number,
  max: number = RATE_LIMIT_MAX_WINDOWS
): void => {
  for (const [key, window] of windows) {
    if (window.resetAt <= now) {
      windows.delete(key);
    }
  }
  for (const key of windows.keys()) {
    if (windows.size < max) {
      return;
    }
    windows.delete(key);
  }
};

export interface RateLimitDecision {
  allowed: boolean;
  limit: number;
  remaining: number;
  // Seconds until this client's window resets
  resetSeconds: number;
}

// A fixed-window counter per client and route, in this process's memory. It
// bounds a naive flood on one container; a fleet relies on its load balancer,
// and a function on its platform - which is why this lives here and not in
// the Fetch core.
export const createRateLimiter = (
  limits: RateLimits,
  now: () => number = Date.now
): ((pathname: string, client: string) => RateLimitDecision | undefined) => {
  const windows = new Map<string, RateWindow>();

  return (pathname, client) => {
    const route = limitedRoute(pathname);
    if (!route || limits[route] === 0) {
      return undefined;
    }
    const limit = limits[route];
    const key = `${route}:${client}`;
    const current = now();
    if (windows.size >= RATE_LIMIT_MAX_WINDOWS) {
      sweepWindows(windows, current);
    }
    const window = windows.get(key);
    if (!window || window.resetAt <= current) {
      windows.set(key, { count: 1, resetAt: current + RATE_LIMIT_WINDOW_MS });
      return {
        allowed: true,
        limit,
        remaining: limit - 1,
        resetSeconds: RATE_LIMIT_WINDOW_MS / 1000,
      };
    }
    window.count += 1;
    const resetSeconds = Math.ceil((window.resetAt - current) / 1000);
    return {
      allowed: window.count <= limit,
      limit,
      remaining: Math.max(0, limit - window.count),
      resetSeconds,
    };
  };
};

// The RFC 9331 draft headers express (`standardHeaders: 'draft-7'`) sent
const rateLimitHeaders = (decision: RateLimitDecision): Record<string, string> => ({
  ratelimit: `limit=${decision.limit}, remaining=${decision.remaining}, reset=${decision.resetSeconds}`,
  'ratelimit-policy': `${decision.limit};w=${RATE_LIMIT_WINDOW_MS / 1000}`,
});

// A shutdown reports rather than throws: nothing is listening for the
// rejection of a signal handler, and the process is going away anyway.
export const shutdown = async (close: () => Promise<void>): Promise<void> => {
  try {
    await close();
  } catch (error) {
    console.error('Shutdown failed:', error);
  }
};

export interface RunningServer {
  // Where the server is listening (the port the OS assigned, with PORT=0)
  url: string;
  // Close the listener and drain the app
  stop: () => Promise<void>;
}

export interface StartServerDeps extends ESignAppDeps {
  // The socket address, when the platform reports one (the Node bridge does)
  clientAddress?: (bindings: unknown) => string | undefined;
}

const socketAddress = (bindings: unknown): string | undefined =>
  (bindings as { incoming?: { socket?: { remoteAddress?: string } } })?.incoming?.socket
    ?.remoteAddress;

export const startServer = async (
  env: Env = process.env,
  deps: StartServerDeps = {}
): Promise<RunningServer> => {
  // Fail closed before the listener exists: a misconfigured container never
  // accepts a connection. This target can serve envelopes, so it is the one
  // that knows how to reach the Node-only module.
  const app = createESignApp(env, { loadEnvelopes, ...deps });

  const limiter = createRateLimiter(rateLimitsFromEnv(env));
  const trustProxy = trustsProxy(env);
  // The limiter answers before the app is reached, so this target applies
  // the app's own header policy to the one response it writes itself
  const origins = getAllowedOrigins(env);
  const address = deps.clientAddress ?? socketAddress;

  const clientOf = (request: Request, bindings: unknown): string =>
    forwardedClientIp(request, trustProxy) || address(bindings) || 'unknown';

  const server = serve({
    port: resolvePort(env),
    fetch: async (request: Request, bindings: unknown) => {
      const decision = limiter(new URL(request.url).pathname, clientOf(request, bindings));
      if (decision && !decision.allowed) {
        const limited = new Response(JSON.stringify({ error: 'Too many requests' }), {
          status: 429,
          headers: {
            'content-type': 'application/json',
            'retry-after': String(decision.resetSeconds),
            ...rateLimitHeaders(decision),
          },
        });
        return withDefaults(withDefaults(limited, corsHeaders(origins, request)), SECURITY_HEADERS);
      }
      const response = await app.fetch(request);
      if (decision) {
        for (const [key, value] of Object.entries(rateLimitHeaders(decision))) {
          response.headers.set(key, value);
        }
      }
      return response;
    },
  });

  await new Promise<void>((resolve) => server.once('listening', resolve));
  const { port } = server.address() as AddressInfo;
  const url = `http://localhost:${port}`;

  const close = async (): Promise<void> => {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    );
    await app.stop();
  };

  // Drain on SIGTERM (what an orchestrator sends): stop accepting, finish
  // what is in flight, then let the process exit on its own.
  const drain = (): void => {
    void shutdown(close);
  };
  process.once('SIGTERM', drain);

  console.log(`🚀 esign-service ready at ${url} (capabilities: ${app.capabilities.join(', ')})`);
  console.log(`🏥 Health check at ${url}/health`);
  console.log(`📝 E-signature provider: ${env.ESIGN_PROVIDER || 'mock'}`);

  return {
    url,
    stop: async () => {
      process.removeListener('SIGTERM', drain);
      await close();
    },
  };
};
