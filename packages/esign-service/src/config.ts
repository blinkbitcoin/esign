// The boot guard: what must be true before this deployment answers a single
// request, checked once, in one place, from the environment alone.
//
// It refuses only for what is actually broken - credentials a mint cannot do
// without, a provider name nothing answers to, a runtime asked for something
// it cannot do. What a deployment does not *verify* is not broken: it is a
// choice, reported by the banner (posture.ts) and left to the operator,
// because whether an unverified session or a client-supplied prefill matters
// depends on things this process cannot see. ESIGN_STRICT=true is the one
// opt-in that turns every such choice back into a refusal.
//
// `configErrors` is pure - env in, a list of problems out - so the container
// checks the same rules at boot that a Vercel or Worker function checks at
// first import, and `validateConfig` throws one message listing all of them
// plus the capabilities that are on.

import { consoleLogger, type Logger } from '@blinkbitcoin/esign-node';
import {
  type Capability,
  capabilitiesFromEnv,
  describeCapabilities,
  hasEnvelopes,
} from './capabilities';
import { type Env, ESIGN_STRICT, isStrict } from './env';
import {
  ESIGN_MINT_MODE,
  isMintModeName,
  MINT_MODE_NAMES,
  type MintMode,
  mintModeFromEnv,
  requestedMintMode,
} from './mint';
import { type Check, formatBanner, postureLines } from './posture';
import { ESIGN_PREFILL_URL } from './prefill';
import { ESIGN_SESSION_JWKS_URL, ESIGN_SESSION_SECRET } from './session';

export { type Env, ESIGN_STRICT, isStrict } from './env';

// Where the app runs. `node` has a filesystem, a Postgres driver and the
// GraphQL executor; `edge` (a Cloudflare Worker) has none of them and serves
// the mint only.
export type Runtime = 'node' | 'edge';

export interface ValidateConfigOptions {
  // The target this configuration is being checked for (default 'node')
  runtime?: Runtime;
  // Where the boot banner goes (default: the console). Injected so tests
  // stay silent and so a host can route it into its own logging.
  logger?: Logger;
}

// A prefill callback this service cannot POST to is broken however the
// deployment is labelled, so the shape of the URL is checked here. Whether
// having no callback at all is acceptable is the operator's call, reported
// by the banner - not a refusal.
const prefillUrlErrors = (env: Env): string[] => {
  const url = env[ESIGN_PREFILL_URL];
  if (!url) {
    return [];
  }
  const parsed = ((): URL | undefined => {
    try {
      return new URL(url);
    } catch {
      return undefined;
    }
  })();
  return !parsed || (parsed.protocol !== 'http:' && parsed.protocol !== 'https:')
    ? [`${ESIGN_PREFILL_URL} must be an absolute http(s) URL (got ${url})`]
    : [];
};

// The mint answers one way per deployment, and only a way it knows
const mintModeErrors = (env: Env): string[] => {
  const name = requestedMintMode(env);
  const known = MINT_MODE_NAMES.map((mode) => `'${mode}'`).join(' or ');
  return isMintModeName(name) ? [] : [`${ESIGN_MINT_MODE} must be ${known} (got ${name})`];
};

// The provider must be able to mint what this deployment mints: the settings
// the mode's mint needs have to be present. Whether those settings point at
// a sandbox is the banner's to report, not this guard's to refuse.
const providerErrors = (env: Env, runtime: Runtime, mode: MintMode): string[] => {
  // A typo'd ESIGN_PROVIDER must be a boot error here, not a silent fallback
  // with a warning
  const onUnknown = (name: string): never => {
    throw new Error(`unknown ESIGN_PROVIDER: ${name}`);
  };
  const edgeDocuSign =
    runtime === 'edge'
      ? {
          readFile: (): never => {
            throw new Error(
              'DOCUSIGN_PRIVATE_KEY_FILE is container-only: use DOCUSIGN_PRIVATE_KEY_BASE64 on this runtime'
            );
          },
        }
      : {};
  try {
    mode.selectProvider(env, { default: 'mock', onUnknown, docusign: edgeDocuSign });
    return [];
  } catch (error) {
    // Everything the package's selection throws is an Error
    // (DocuSignConfigError, the unknown-name error)
    return [(error as Error).message];
  }
};

// Under ESIGN_STRICT every check the banner would report as unverified is a
// refusal instead, each naming the variable that fixes it. This is the whole
// of the old fail-closed posture, behind one opt-in rather than five flags.
const FIX: Record<Check, string> = {
  provider:
    'point DOCUSIGN_BASE_URL, DOCUSIGN_OAUTH_URL and DOCUSIGN_WEBFORMS_BASE_URL at production hosts, or select a real provider with ESIGN_PROVIDER',
  session: `set ${ESIGN_SESSION_JWKS_URL} or ${ESIGN_SESSION_SECRET}`,
  prefill: `set ${ESIGN_PREFILL_URL} so your backend computes the field values`,
  webhook: 'set DOCUSIGN_HMAC_KEY to verify the envelope webhook',
};

const strictErrors = (env: Env): string[] =>
  isStrict(env)
    ? postureLines(env)
        .filter((line) => !line.verified)
        .map((line) => `${ESIGN_STRICT}=true: ${line.check} is ${line.detail} - ${FIX[line.check]}`)
    : [];

// What this environment asks for that this runtime cannot do
const runtimeErrors = (env: Env, runtime: Runtime): string[] =>
  runtime === 'edge' && hasEnvelopes(env)
    ? [
        'DATABASE_URL is set, but this runtime cannot open a Postgres connection: the Cloudflare target serves the mint only. Deploy the container or the Node target for envelope orchestration',
      ]
    : [];

// Everything wrong with running `env` on `runtime`, one message per problem.
// Pure: no process.env, no connections, no side effects a caller can see.
export const configErrors = (env: Env, options: ValidateConfigOptions = {}): string[] => {
  const runtime = options.runtime ?? 'node';
  const mode = mintModeFromEnv(env);
  return [
    ...prefillUrlErrors(env),
    ...mintModeErrors(env),
    ...providerErrors(env, runtime, mode),
    ...runtimeErrors(env, runtime),
    ...strictErrors(env),
  ];
};

// Validate at boot, print the posture, and report the capabilities that are
// on. Throws one message listing every problem - a misconfigured container
// fails to start, and a misconfigured function fails at first import.
//
// The banner prints on every successful construction, on every target, so
// what a deployment does and does not verify is in its logs whether it runs
// as a container, a Vercel function or a Worker.
export const validateConfig = (
  env: Env = process.env,
  options: ValidateConfigOptions = {}
): Capability[] => {
  const capabilities = capabilitiesFromEnv(env);
  const errors = configErrors(env, options);
  if (errors.length > 0) {
    throw new Error(
      `Refusing to start (capabilities: ${describeCapabilities(capabilities)}): ${errors.join('; ')}`
    );
  }
  (options.logger ?? consoleLogger).log(formatBanner(env, capabilities));
  return capabilities;
};

// Allowed CORS origins from ESIGN_CORS_ALLOWED_ORIGINS (comma-separated).
// Empty => same-origin only (no cross-origin browser access).
export const getAllowedOrigins = (env: Env = process.env): string[] =>
  (env.ESIGN_CORS_ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
