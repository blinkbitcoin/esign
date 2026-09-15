// Does the key set this deployment was given actually answer?
//
// Setting ESIGN_SESSION_JWKS_URL correctly and setting it plausibly are
// different things, and nothing used to tell them apart: createRemoteJWKSet
// is lazy, so a typo'd host booted clean and then 401'd every request with no
// reason given. That is the kind of mistake that is obvious the moment
// anything says it out loud, and invisible otherwise.
//
// ESIGN_PREFILL_URL is deliberately NOT probed. It is an endpoint on someone
// else's service that expects a POST, and sending it an unexpected request on
// every boot is a side effect the operator did not ask for - a naive handler
// that reads the body without guarding crashes on a bodyless HEAD, which is
// exactly what happened to this repo's own demo stub the first time this ran.
// `node dist/node.js check-prefill` verifies that endpoint instead: an
// explicit command, sending the real POST the mint would send.
//
// Why this is not in config.ts: validateConfig is synchronous and runs at
// FIRST IMPORT on the Vercel and Cloudflare targets. Network I/O cannot go
// there. So this is a separate async step the Node target awaits before it
// listens, and the function targets skip - a function has no startup phase to
// spend, and its first request would pay for one.
//
// Nothing here throws. A probe that fails is a Probe with ok: false, because
// "your key set is unreachable" is information, not a reason for the process
// to die - unless ESIGN_STRICT says it is (server.ts).

import type { Env } from './env';
import type { Check } from './posture';
import { ESIGN_SESSION_JWKS_URL } from './session';

export interface Probe {
  // Which posture check this probe is about
  check: Check;
  // Did the URL answer in a way that suggests it is the right one?
  ok: boolean;
  // What an operator reads next to the check
  detail: string;
}

export interface PreflightDeps {
  fetch?: typeof globalThis.fetch;
}

// A preflight must not hold a container's startup open: a URL that does not
// answer in three seconds is reported as not answering.
const TIMEOUT_MS = 3000;

// The message from whatever went wrong, without the stack
const because = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

// The host alone, so the line stays readable; the full URL is in the env
const hostOf = (url: string): string => {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
};

// A JSON Web Key Set is a document with a `keys` array. Fetching it proves
// the URL resolves, answers, and is the kind of document jose will accept -
// which is every way this variable is usually wrong.
const probeKeySet = async (url: string, doFetch: typeof globalThis.fetch): Promise<Probe> => {
  const host = hostOf(url);
  let response: Response;
  try {
    response = await doFetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (error) {
    return { check: 'session', ok: false, detail: `${host} unreachable: ${because(error)}` };
  }
  if (!response.ok) {
    return { check: 'session', ok: false, detail: `${host} answered ${response.status}` };
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return { check: 'session', ok: false, detail: `${host} did not answer with JSON` };
  }
  const keys = (body as { keys?: unknown } | null)?.keys;
  if (!Array.isArray(keys) || keys.length === 0) {
    return { check: 'session', ok: false, detail: `${host} answered no keys` };
  }
  const algorithms = [
    ...new Set(keys.map((key) => (key as { alg?: unknown }).alg).filter(Boolean)),
  ].join(', ');
  const count = `${keys.length} key${keys.length === 1 ? '' : 's'}`;
  return {
    check: 'session',
    ok: true,
    detail: algorithms ? `${count} from ${host} (${algorithms})` : `${count} from ${host}`,
  };
};

// Probe what this deployment configured, and only that: an unset variable is
// not a failed probe, it is a deployment that made a choice the banner
// already reported.
export const preflight = async (env: Env, deps: PreflightDeps = {}): Promise<Probe[]> => {
  const jwks = env[ESIGN_SESSION_JWKS_URL];
  return jwks ? [await probeKeySet(jwks, deps.fetch ?? globalThis.fetch)] : [];
};

// The probes as banner rows, in the same shape posture.ts uses, so they read
// as continuations of the lines above them rather than as a second report.
export const formatProbes = (probes: readonly Probe[]): string =>
  probes
    .map((probe) => `  ${probe.check.padEnd(12)}  ${probe.ok ? '' : '! '}${probe.detail}`)
    .join('\n');
