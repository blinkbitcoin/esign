// What this deployment can do, decided by the environment alone.
//
// The mint (POST /webform/instance, or POST /envelope/instance under
// ESIGN_MINT_MODE=envelope, plus the return-URL bridge and /health) is always
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

// --- What the mint answers with ----------------------------------------------

// The variable that chooses it
export const ESIGN_MINT_MODE = 'ESIGN_MINT_MODE';

// `webform` (the default, what every deployment ran before the choice
// existed): POST /webform/instance mints a Web Forms instance, whose pages the
// signer answers before reaching the document. `envelope`: POST
// /envelope/instance creates an envelope from DOCUSIGN_TEMPLATE_ID (several
// ids, one envelope, in that order) and answers its signing URL, so the signer
// opens the documents themselves with the prefill already on them. Neither
// needs a database, and a deployment serves exactly one of the two.
const MINT_MODES = ['webform', 'envelope'] as const;

export type MintMode = (typeof MINT_MODES)[number];

export const isMintMode = (value: string): value is MintMode =>
  (MINT_MODES as readonly string[]).includes(value);

// The mode this environment asks for, as written (the boot guard refuses one
// that is not a MintMode). Unset is the Web Form, and so is a blank or
// whitespace-only value, as DATABASE_URL's is: an env file with
// `ESIGN_MINT_MODE=` must not stop a deployment from booting.
export const requestedMintMode = (env: Env): string =>
  (env[ESIGN_MINT_MODE] ?? '').trim() || 'webform';

// Whether the mint answers with an envelope rather than a Web Form
export const isEnvelopeMint = (env: Env): boolean => requestedMintMode(env) === 'envelope';

// --- The mock provider's signing pages ---------------------------------------

// Whether this service serves the mock provider's signing pages
export const MOCK_PAGES = 'MOCK_PAGES';

// The pages exist only for the mock provider - a real provider hosts its own
// - and MOCK_PAGES=false turns them off even for the mock (a deployment that
// only wants the mint surface).
export const mockPagesEnabled = (env: Env): boolean =>
  (env.ESIGN_PROVIDER ?? 'mock') === 'mock' && env[MOCK_PAGES] !== 'false';
