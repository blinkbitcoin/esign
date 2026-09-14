// The boot guard: everything that must be true before this deployment
// answers a single request, checked once, in one place, from the environment
// alone.
//
// The posture is enforced at STARTUP, not inferred per request from NODE_ENV.
// A deployment that lacks what it needs must refuse to start (fail-closed)
// rather than silently trusting clients. Local development that intentionally
// runs without secrets opts in explicitly with ALLOW_INSECURE_DEV=true.
//
// `configErrors` is pure - env in, a list of problems out - so the container
// checks the same rules at boot that a Vercel or Worker function checks at
// first import, and `validateConfig` throws one message listing all of them
// plus the capabilities that are on.

import {
  type Capability,
  capabilitiesFromEnv,
  describeCapabilities,
  hasEnvelopes,
} from './capabilities';
import { type Env, isInsecureDevAllowed } from './env';
import {
  ESIGN_MINT_MODE,
  isMintModeName,
  MINT_MODE_NAMES,
  type MintMode,
  mintModeFromEnv,
  requestedMintMode,
} from './mint';
import { SESSION_HS256_SECRET, SESSION_JWKS_URL, sessionSourceFromEnv } from './session';
import { TERMS_URL } from './terms';

export { ALLOW_INSECURE_DEV, type Env, isInsecureDevAllowed } from './env';

// The explicit opt-in to minting the client's own prefill in production
export const ESIGN_ALLOW_CLIENT_PREFILL = 'ESIGN_ALLOW_CLIENT_PREFILL';

// The variable that declares a deployment production (the package's guard
// reads the same one; NODE_ENV never decides anything here)
export const ESIGN_ENV = 'ESIGN_ENV';

// Where the app runs. `node` has a filesystem, a Postgres driver and the
// GraphQL executor; `edge` (a Cloudflare Worker) has none of them and serves
// the mint only.
export type Runtime = 'node' | 'edge';

export interface ValidateConfigOptions {
  // The target this configuration is being checked for (default 'node')
  runtime?: Runtime;
}

// Auth requires a verified session unless insecure-dev is explicitly allowed.
export const isJwtRequired = (env: Env = process.env): boolean => !isInsecureDevAllowed(env);

// Webhooks require signature verification unless insecure-dev is allowed AND
// no key is configured (mock-provider local runs).
export const isWebhookSignatureRequired = (env: Env = process.env): boolean =>
  !isInsecureDevAllowed(env);

// Is this deployment declared production?
const isProductionEnv = (env: Env): boolean => env[ESIGN_ENV] === 'production';

// The session source must exist: without one, nothing can turn a bearer
// token into a user id, and every request would be anonymous.
const sessionErrors = (env: Env): string[] =>
  sessionSourceFromEnv(env) === null
    ? [
        `no session verification is configured: set ${SESSION_JWKS_URL} or ${SESSION_HS256_SECRET} (JWT_SECRET is an accepted alias), or ALLOW_INSECURE_DEV=true for local dev`,
      ]
    : [];

// The opt-in to a plaintext terms callback in production, for a host whose
// hop is private but whose name this guard cannot recognise.
export const TERMS_ALLOW_INSECURE = 'TERMS_ALLOW_INSECURE';

// Hosts a plaintext terms callback cannot leak to the internet: the loopback
// interface, and the private naming schemes a cluster resolves internally
// (Kubernetes `<service>.<namespace>.svc[.cluster.local]`, and the `.internal`
// suffix Google Cloud, AWS and others use for VPC-private records).
const isPrivateHost = (hostname: string): boolean => {
  const host = hostname.toLowerCase().replace(/\.$/, '');
  return (
    host === 'localhost' ||
    host === '::1' ||
    host === '[::1]' ||
    /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host) ||
    host.endsWith('.localhost') ||
    host.endsWith('.internal') ||
    host === 'svc' ||
    host.endsWith('.svc') ||
    host.endsWith('.svc.cluster.local')
  );
};

// TERMS_URL must be a URL this service can actually POST to, and a
// production deployment without one is minting whatever the client sent -
// allowed, but only when the operator says so in as many words.
//
// In production the callback also has to be encrypted: createTermsPrefill
// forwards the caller's own session bearer AND TERMS_SHARED_SECRET to that
// URL, so a plaintext hop hands both to anyone on the path. A private hop
// (loopback, `*.svc`, `*.svc.cluster.local`, `*.internal`) is the legitimate
// exception, and TERMS_ALLOW_INSECURE=true is the explicit escape for the
// private host this guard cannot recognise by name.
const termsErrors = (env: Env, mode: MintMode): string[] => {
  const url = env[TERMS_URL];
  if (!url) {
    return isProductionEnv(env) && env[ESIGN_ALLOW_CLIENT_PREFILL] !== 'true'
      ? [
          `${ESIGN_ENV}=production without ${TERMS_URL}: ${mode.clientTerms} would be minted as sent. Set ${TERMS_URL}, or ${ESIGN_ALLOW_CLIENT_PREFILL}=true to accept client-supplied terms`,
        ]
      : [];
  }
  const parsed = ((): URL | undefined => {
    try {
      return new URL(url);
    } catch {
      return undefined;
    }
  })();
  if (!parsed || (parsed.protocol !== 'http:' && parsed.protocol !== 'https:')) {
    return [`${TERMS_URL} must be an absolute http(s) URL (got ${url})`];
  }
  return parsed.protocol === 'http:' &&
    isProductionEnv(env) &&
    !isPrivateHost(parsed.hostname) &&
    env[TERMS_ALLOW_INSECURE] !== 'true'
    ? [
        `${ESIGN_ENV}=production with a plaintext ${TERMS_URL} (${url}): the caller's session token and TERMS_SHARED_SECRET would travel in cleartext. Use https, a private host (loopback, *.svc, *.svc.cluster.local, *.internal), or ${TERMS_ALLOW_INSECURE}=true`,
      ]
    : [];
};

// The mint answers one way per deployment, and only a way it knows
const mintModeErrors = (env: Env): string[] => {
  const name = requestedMintMode(env);
  const known = MINT_MODE_NAMES.map((mode) => `'${mode}'`).join(' or ');
  return isMintModeName(name) ? [] : [`${ESIGN_MINT_MODE} must be ${known} (got ${name})`];
};

// The provider must be able to mint what this deployment mints: the settings
// the mode's mint needs have to be present, and a production deployment must
// not be on demo settings. The package's own selection does both checks
// (PR a) - running it here is how they happen at boot instead of on the
// first mint.
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
    // (DocuSignConfigError, ProductionConfigError, the unknown-name error)
    return [(error as Error).message];
  }
};

// The Connect HMAC key verifies inbound webhooks, so it is required exactly
// when the webhook route exists - that is, when envelope orchestration is on
// and the provider actually signs.
const webhookErrors = (env: Env): string[] =>
  hasEnvelopes(env) &&
  (env.ESIGN_PROVIDER ?? 'mock') === 'docusign' &&
  !env.DOCUSIGN_HMAC_KEY &&
  !isInsecureDevAllowed(env)
    ? ['DOCUSIGN_HMAC_KEY is required to verify the envelope webhook (or ALLOW_INSECURE_DEV=true)']
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
    ...sessionErrors(env),
    ...termsErrors(env, mode),
    ...mintModeErrors(env),
    ...providerErrors(env, runtime, mode),
    ...webhookErrors(env),
    ...runtimeErrors(env, runtime),
  ];
};

// Validate at boot and report the capabilities that are on. Throws one
// message listing every problem - a misconfigured container fails to start,
// and a misconfigured function fails at first import.
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
  if (isInsecureDevAllowed(env)) {
    console.warn(
      '⚠️  ALLOW_INSECURE_DEV=true - session and webhook signature verification may be bypassed. NEVER set this in production.'
    );
  }
  return capabilities;
};

// Allowed CORS origins from CORS_ALLOWED_ORIGINS (comma-separated).
// Empty => same-origin only (no cross-origin browser access).
export const getAllowedOrigins = (env: Env = process.env): string[] =>
  (env.CORS_ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
