// What this deployment verifies, from the environment alone.
//
// The service used to answer this question by refusing to start: five flags
// decided whether a missing session source, a client-supplied prefill, an
// unsigned webhook or a sandbox provider was acceptable. It could not
// actually know. Whether a client's prefill matters depends on whether the
// template's fields carry the deal; whether an unverified session matters
// depends on what sits in front of the service. Both are the operator's to
// judge, and neither is visible from in here.
//
// So this module describes instead. Each check answers "is this verified,
// and if not, what does that mean" - and the deployment starts. An operator
// who wants the old behaviour sets ESIGN_STRICT=true (config.ts), which
// turns every unverified line into a boot error.
//
// Pure: env in, lines out. No process.env, no connections, no provider
// imports - the provider's own description comes from providers/ (see
// describeProvider), so nothing here knows what a DocuSign sandbox is.

import { type Capability, describeCapabilities, hasEnvelopes } from './capabilities';
import type { Env } from './env';
import { mintModeFromEnv } from './mint';
import { ESIGN_PREFILL_URL } from './prefill';
import { describeProvider } from './providers';
import { ESIGN_SESSION_JWKS_URL, ESIGN_SESSION_SECRET, sessionSourceFromEnv } from './session';

// The four things a deployment either verifies or does not
export type Check = 'provider' | 'session' | 'prefill' | 'webhook';

export interface Line {
  check: Check;
  // Does this deployment verify it? A check that does not apply - the
  // webhook of a mint-only deployment - is verified: there is nothing
  // unverified about a route that does not exist.
  verified: boolean;
  // What an operator reads next to the check name
  detail: string;
}

// The bearer token becomes a user id one of two ways, or not at all
const sessionLine = (env: Env): Line => {
  switch (sessionSourceFromEnv(env)) {
    case 'jwks':
      return { check: 'session', verified: true, detail: `verified (${ESIGN_SESSION_JWKS_URL})` };
    case 'hs256':
      return { check: 'session', verified: true, detail: `verified (${ESIGN_SESSION_SECRET})` };
    default:
      return {
        check: 'session',
        verified: false,
        detail: 'not verified - the bearer token is the user id',
      };
  }
};

// Who decides the values a signer cannot change
const prefillLine = (env: Env): Line =>
  env[ESIGN_PREFILL_URL]
    ? { check: 'prefill', verified: true, detail: `from ${ESIGN_PREFILL_URL}` }
    : {
        check: 'prefill',
        verified: false,
        detail: `client-supplied (${ESIGN_PREFILL_URL} unset)`,
      };

// The webhook exists only when envelope orchestration does, so a mint-only
// deployment has nothing to verify rather than something unverified
const webhookLine = (env: Env): Line => {
  if (!hasEnvelopes(env)) {
    return { check: 'webhook', verified: true, detail: 'n/a (mint only)' };
  }
  return env.DOCUSIGN_HMAC_KEY
    ? { check: 'webhook', verified: true, detail: 'verified (DOCUSIGN_HMAC_KEY)' }
    : { check: 'webhook', verified: false, detail: 'not verified (DOCUSIGN_HMAC_KEY unset)' };
};

// A provider on its sandbox signs nothing that holds; that is worth saying
// out loud, and worth refusing under ESIGN_STRICT
const providerLine = (env: Env): Line => {
  const { name, demo } = describeProvider(env);
  return demo.length === 0
    ? { check: 'provider', verified: true, detail: name }
    : { check: 'provider', verified: false, detail: `${name} - ${demo.join('; ')}` };
};

// Every check, in the order the banner prints them
export const postureLines = (env: Env): Line[] => [
  providerLine(env),
  sessionLine(env),
  prefillLine(env),
  webhookLine(env),
];

// The banner's fixed label column, wide enough for 'capabilities'
const LABEL_WIDTH = 12;

const row = (label: string, value: string): string => `  ${label.padEnd(LABEL_WIDTH)}  ${value}`;

// What the service prints once at startup: what it can do, how it mints, and
// what it does and does not verify. Every deployment gets the same six
// lines, so "not verified" is read in the same place every time rather than
// being the absence of a warning.
export const formatBanner = (env: Env, capabilities: readonly Capability[]): string =>
  [
    row('capabilities', describeCapabilities(capabilities)),
    row('mint mode', mintModeFromEnv(env).name),
    ...postureLines(env).map((line) => row(line.check, line.detail)),
  ].join('\n');
