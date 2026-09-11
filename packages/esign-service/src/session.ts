// Session verification: the one place a caller's bearer token becomes the
// user id the mint and the GraphQL context use (and the id DocuSign sees as
// `clientUserId`). Webhooks are not authenticated this way - they carry the
// provider's HMAC signature instead.
//
// One source, chosen by the environment alone:
//   SESSION_JWKS_URL      - RS/ES tokens against a remote, cached key set;
//                           optional SESSION_ISSUER / SESSION_AUDIENCE
//   SESSION_HS256_SECRET  - a shared secret (JWT_SECRET is an accepted alias)
//   ALLOW_INSECURE_DEV    - no verification: the bearer token IS the user id.
//                           Local dev and the CI smoke only.
// With none of them configured there is no verifier, and validateConfig
// (config.ts) refuses to boot - the same fail-closed posture as before, now
// with a second, keyless source.
//
// `jose` does both checks, so JWKS and HS256 share one code path: the same
// claim selection, the same required `exp`, the same null-on-anything-wrong
// contract (an unverifiable token is simply unauthenticated).

import { createRemoteJWKSet, type JWTPayload, type JWTVerifyGetKey, jwtVerify } from 'jose';

import { type Env, isInsecureDevAllowed } from './env';

// A verified session: the caller's user id, or null when the token proves
// nothing (missing, malformed, expired, wrong key, wrong issuer/audience)
export type SessionVerifier = (token: string) => Promise<string | null>;

export const SESSION_JWKS_URL = 'SESSION_JWKS_URL';
export const SESSION_HS256_SECRET = 'SESSION_HS256_SECRET';

// The name this service shipped with, kept as an alias of
// SESSION_HS256_SECRET (documented; no deprecation warning)
export const JWT_SECRET = 'JWT_SECRET';

export const SESSION_ISSUER = 'SESSION_ISSUER';
export const SESSION_AUDIENCE = 'SESSION_AUDIENCE';
export const SESSION_USER_CLAIM = 'SESSION_USER_CLAIM';

// The claim carrying the user id unless SESSION_USER_CLAIM says otherwise
export const DEFAULT_USER_CLAIM = 'sub';

// Which of the three sources this environment configures, in precedence
// order, or null when it configures none
export type SessionSource = 'jwks' | 'hs256' | 'insecure';

export const sessionSourceFromEnv = (env: Env): SessionSource | null => {
  if (env[SESSION_JWKS_URL]) {
    return 'jwks';
  }
  if (env[SESSION_HS256_SECRET] || env[JWT_SECRET]) {
    return 'hs256';
  }
  return isInsecureDevAllowed(env) ? 'insecure' : null;
};

// Warn once (not per request) when running without verification
let warnedDevPassthrough = false;

// Test helper: reset the warn-once flag between tests
export const resetDevPassthroughWarning = (): void => {
  warnedDevPassthrough = false;
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
  const claim = env[SESSION_USER_CLAIM] || DEFAULT_USER_CLAIM;
  const issuer = env[SESSION_ISSUER];
  const audience = env[SESSION_AUDIENCE];
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

// The verifier this environment describes. Throws when it describes none -
// callers reach this through validateConfig, which lists the same problem
// with the rest of the boot errors.
export const sessionVerifierFromEnv = (env: Env): SessionVerifier => {
  switch (sessionSourceFromEnv(env)) {
    case 'jwks': {
      // createRemoteJWKSet caches the fetched keys (and coalesces refreshes),
      // so building it once per app is the cache.
      const jwks = createRemoteJWKSet(new URL(env[SESSION_JWKS_URL] as string));
      return verifyWith(jwks, env, JWKS_ALGORITHMS);
    }
    case 'hs256': {
      const secret = (env[SESSION_HS256_SECRET] || env[JWT_SECRET]) as string;
      return verifyWith(new TextEncoder().encode(secret), env, ['HS256']);
    }
    case 'insecure':
      return async (token) => {
        if (!warnedDevPassthrough) {
          console.warn(
            '⚠️  ALLOW_INSECURE_DEV=true - the bearer token is taken as the user id, unverified. NEVER set this in production.'
          );
          warnedDevPassthrough = true;
        }
        return token || null;
      };
    default:
      throw new Error(
        `no session verification configured: set ${SESSION_JWKS_URL} or ${SESSION_HS256_SECRET} (or ALLOW_INSECURE_DEV=true for local dev)`
      );
  }
};
