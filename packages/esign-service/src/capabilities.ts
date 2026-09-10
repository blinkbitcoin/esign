// What this deployment can do, decided by the environment alone.
//
// The mint (POST /webform/instance, the return-URL bridge, /health) is always
// on: it needs no database and no state, so every target - a container, a
// Vercel route, a Cloudflare Worker - serves it. Envelope orchestration (the
// GraphQL API, the provider webhook, the Knex store and its migrations) needs
// Postgres, so it follows DATABASE_URL: set it and the routes exist, leave it
// unset and they are absent, no pg connection is opened and no
// DOCUSIGN_HMAC_KEY is required.
//
// Pure: env in, capabilities out. Nothing here reads process.env, opens a
// connection or imports a runtime-specific module.

import type { Env } from './env';

export type { Env };

// The capability that is always on
export const MINT = 'mint';

// The capability DATABASE_URL switches on
export const ENVELOPES = 'envelopes';

export type Capability = typeof MINT | typeof ENVELOPES;

// The variable that decides envelope orchestration
export const DATABASE_URL = 'DATABASE_URL';

// Envelope orchestration is on exactly when DATABASE_URL holds a value; a
// blank or whitespace-only value is "unset" (an env file with `DATABASE_URL=`
// must not half-enable the capability and then fail to connect).
export const hasEnvelopes = (env: Env): boolean => (env[DATABASE_URL] ?? '').trim().length > 0;

// The capabilities this environment turns on, in report order
export const capabilitiesFromEnv = (env: Env): Capability[] =>
  hasEnvelopes(env) ? [MINT, ENVELOPES] : [MINT];

// The capability list as one line, for /health and the boot guard's message
export const describeCapabilities = (capabilities: readonly Capability[]): string =>
  capabilities.join(', ');

// --- The mock provider's signing pages ---------------------------------------

// Whether this service serves the mock provider's signing pages
export const MOCK_PAGES = 'MOCK_PAGES';

// The pages exist only for the mock provider - a real provider hosts its own
// - and MOCK_PAGES=false turns them off even for the mock (a deployment that
// only wants the mint surface).
export const mockPagesEnabled = (env: Env): boolean =>
  (env.ESIGN_PROVIDER ?? 'mock') === 'mock' && env[MOCK_PAGES] !== 'false';
