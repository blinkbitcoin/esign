// Session verification: the one place a caller's bearer token becomes the
// user id the mint and the GraphQL context use (and the id DocuSign sees as
// `clientUserId`). Webhooks are not authenticated this way - they carry the
// provider's HMAC signature instead.
//
// One source, chosen by the environment alone:
//   ESIGN_SESSION_JWKS_URL - RS/ES tokens against a remote, cached key set;
//                           optional ESIGN_SESSION_ISSUER / ESIGN_SESSION_AUDIENCE
//   ESIGN_SESSION_SECRET  - a shared secret, HS256
// With neither configured the session is unverified: the bearer token IS the
// user id. That is a real deployment - a service reachable only through a
// gateway that already authenticated the caller - not an error, so it runs
// and the boot banner says so (posture.ts). ESIGN_STRICT=true is where an
// operator asks for it to be refused instead.
//
// `jose` does both checks, so JWKS and HS256 share one code path: the same
// claim selection, the same required `exp`, the same null-on-anything-wrong
// contract (an unverifiable token is simply unauthenticated).

import { createRemoteJWKSet, type JWTPayload, type JWTVerifyGetKey, jwtVerify } from 'jose';

import type { Env } from './env';

// A verified session: the caller's user id, or null when the token proves
// nothing (missing, malformed, expired, wrong key, wrong issuer/audience)
export type SessionVerifier = (token: string) => Promise<string | null>;

export const ESIGN_SESSION_JWKS_URL = 'ESIGN_SESSION_JWKS_URL';
export const ESIGN_SESSION_SECRET = 'ESIGN_SESSION_SECRET';

export const ESIGN_SESSION_ISSUER = 'ESIGN_SESSION_ISSUER';
export const ESIGN_SESSION_AUDIENCE = 'ESIGN_SESSION_AUDIENCE';
export const ESIGN_SESSION_USER_CLAIM = 'ESIGN_SESSION_USER_CLAIM';

// The claim carrying the user id unless ESIGN_SESSION_USER_CLAIM says otherwise
export const DEFAULT_USER_CLAIM = 'sub';

// How this environment turns a token into a user id, in precedence order.
// Always one of the three - 'unverified' is a source, not the absence of
// one, so no caller has to handle null.
export type SessionSource = 'jwks' | 'hs256' | 'unverified';

export const sessionSourceFromEnv = (env: Env): SessionSource => {
  if (env[ESIGN_SESSION_JWKS_URL]) {
    return 'jwks';
  }
  if (env[ESIGN_SESSION_SECRET]) {
    return 'hs256';
  }
  return 'unverified';
};

// The user id a verified payload carries, or null when the claim is absent
// or is not a non-empty string
const userFromPayload = (payload: JWTPayload, claim: string): string | null => {
  const value = payload[claim];
  return typeof value === 'string' && value !== '' ? value : null;
};

// The shared verify step: whatever key material, the same options and the
// same "anything wrong is simply unauthenticated" contract. `exp` is
// required - a token without an expiry would be valid forever, and nothing
// here can revoke one.
const verifyWith = (
  key: Uint8Array | JWTVerifyGetKey,
  env: Env,
  algorithms: string[]
): SessionVerifier => {
  const claim = env[ESIGN_SESSION_USER_CLAIM] || DEFAULT_USER_CLAIM;
  const issuer = env[ESIGN_SESSION_ISSUER];
  const audience = env[ESIGN_SESSION_AUDIENCE];
  return async (token) => {
    if (!token) {
      return null;
    }
    try {
      const { payload } = await jwtVerify(token, key as JWTVerifyGetKey, {
        algorithms,
        requiredClaims: ['exp'],
        ...(issuer ? { issuer } : {}),
        ...(audience ? { audience } : {}),
      });
      return userFromPayload(payload, claim);
    } catch {
      return null;
    }
  };
};

// The algorithms a remote key set may sign with: asymmetric only. A JWKS
// deployment must never accept an HS256 token (the classic confusion attack
// turns a public key into a shared secret).
const JWKS_ALGORITHMS = ['RS256', 'RS384', 'RS512', 'ES256', 'ES384', 'ES512', 'PS256'];

// The verifier this environment describes. Total: every environment
// describes one, because an unconfigured environment describes the
// unverified one.
export const sessionVerifierFromEnv = (env: Env): SessionVerifier => {
  switch (sessionSourceFromEnv(env)) {
    case 'jwks': {
      // createRemoteJWKSet caches the fetched keys (and coalesces refreshes),
      // so building it once per app is the cache.
      const jwks = createRemoteJWKSet(new URL(env[ESIGN_SESSION_JWKS_URL] as string));
      return verifyWith(jwks, env, JWKS_ALGORITHMS);
    }
    case 'hs256': {
      const secret = env[ESIGN_SESSION_SECRET] as string;
      return verifyWith(new TextEncoder().encode(secret), env, ['HS256']);
    }
    default:
      // No key material: the token is taken at face value. Said once at
      // boot by the banner, so there is nothing to warn about per request.
      return async (token) => token || null;
  }
};
