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

import { consoleLogger, type Logger, sanitizeForLog } from '@blinkbitcoin/esign-node';
import {
  compactVerify,
  createRemoteJWKSet,
  type JWTPayload,
  type JWTVerifyGetKey,
  jwtVerify,
} from 'jose';

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

// Why a token did not verify. Every one of these used to collapse into the
// same silent 401, which made ESIGN_SESSION_* effectively unconfigurable: a
// slightly wrong issuer and an unreachable key set looked identical from
// outside, and nothing said which.
export type RejectionCause =
  | 'unreachable'
  | 'signature'
  | 'expired'
  | 'issuer'
  | 'audience'
  | 'claim';

// jose's error codes, mapped to one cause and a line naming both sides of
// the mismatch where there are two. The caller still learns nothing - only
// the operator's log gains the reason.
export const describeRejection = (
  error: unknown,
  env: Env
): { cause: RejectionCause; detail: string } => {
  const code = (error as { code?: string } | null)?.code;
  const claimed = (error as { claim?: string } | null)?.claim;
  switch (code) {
    case 'ERR_JWKS_NO_MATCHING_KEY':
      return {
        cause: 'signature',
        detail: `no key in ${ESIGN_SESSION_JWKS_URL} matches the token's kid`,
      };
    case 'ERR_JWKS_TIMEOUT':
    case 'ERR_JWKS_MULTIPLE_MATCHING_KEYS':
      return { cause: 'unreachable', detail: `${ESIGN_SESSION_JWKS_URL}: ${because(error)}` };
    case 'ERR_JWT_EXPIRED':
      return { cause: 'expired', detail: 'the token has expired' };
    case 'ERR_JWS_SIGNATURE_VERIFICATION_FAILED':
    case 'ERR_JWS_INVALID':
    case 'ERR_JWT_INVALID':
      return { cause: 'signature', detail: 'the signature did not verify' };
    case 'ERR_JWT_CLAIM_VALIDATION_FAILED':
      if (claimed === 'iss') {
        return {
          cause: 'issuer',
          detail: `issuer mismatch: ${ESIGN_SESSION_ISSUER} is "${env[ESIGN_SESSION_ISSUER]}" - compare it with the token's iss, trailing slash included`,
        };
      }
      if (claimed === 'aud') {
        return {
          cause: 'audience',
          detail: `audience mismatch: ${ESIGN_SESSION_AUDIENCE} is "${env[ESIGN_SESSION_AUDIENCE]}"`,
        };
      }
      return { cause: 'claim', detail: `required claim "${claimed ?? 'exp'}" is missing` };
    default:
      return { cause: 'signature', detail: because(error) };
  }
};

// The message from whatever went wrong, without the stack
const because = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

// The shared verify step: whatever key material, the same options and the
// same "anything wrong is simply unauthenticated" contract. `exp` is
// required - a token without an expiry would be valid forever, and nothing
// here can revoke one.
//
// The contract to the caller is unchanged - null, every time - but the
// operator is told why, once per distinct cause. Once, because a client
// retrying a bad token must not be able to flood the log; per cause, because
// the second distinct reason is the one that usually explains the first.
const verifyWith = (
  key: Uint8Array | JWTVerifyGetKey,
  env: Env,
  algorithms: string[],
  logger: Logger
): SessionVerifier => {
  const claim = env[ESIGN_SESSION_USER_CLAIM] || DEFAULT_USER_CLAIM;
  const issuer = env[ESIGN_SESSION_ISSUER];
  const audience = env[ESIGN_SESSION_AUDIENCE];
  const reported = new Set<RejectionCause>();
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
      const user = userFromPayload(payload, claim);
      if (user === null && !reported.has('claim')) {
        reported.add('claim');
        logger.warn(
          `token rejected: no usable "${claim}" claim - set ${ESIGN_SESSION_USER_CLAIM} to the claim that carries your user id`
        );
      }
      return user;
    } catch (error) {
      const { cause, detail } = describeRejection(error, env);
      if (!reported.has(cause)) {
        reported.add(cause);
        logger.warn(`token rejected: ${sanitizeForLog(detail)}`);
      }
      return null;
    }
  };
};

// The algorithms a remote key set may sign with: asymmetric only. A JWKS
// deployment must never accept an HS256 token (the classic confusion attack
// turns a public key into a shared secret).
const JWKS_ALGORITHMS = ['RS256', 'RS384', 'RS512', 'ES256', 'ES384', 'ES512', 'PS256'];

// The key material this environment configures, or null when it configures
// none. Separate from the verifier so a diagnostic can check the signature
// ALONE - jwtVerify enforces issuer and audience in the same call, so a
// wrong issuer would otherwise report as a signature failure and send an
// operator looking at the wrong variable (check.ts).
const keyMaterial = (
  env: Env
): { key: Uint8Array | JWTVerifyGetKey; algorithms: string[] } | null => {
  switch (sessionSourceFromEnv(env)) {
    case 'jwks':
      return {
        key: createRemoteJWKSet(new URL(env[ESIGN_SESSION_JWKS_URL] as string)),
        algorithms: JWKS_ALGORITHMS,
      };
    case 'hs256':
      return {
        key: new TextEncoder().encode(env[ESIGN_SESSION_SECRET] as string),
        algorithms: ['HS256'],
      };
    default:
      return null;
  }
};

// Does this token's signature check out against the configured key, ignoring
// every claim? Null when nothing is configured to check it with.
//
// compactVerify, not jwtVerify: jwtVerify validates exp as well, so an
// expired token with a perfectly good signature would report as a signature
// failure. This step answers one question only.
export const verifySignature = async (env: Env, token: string): Promise<boolean | null> => {
  const material = keyMaterial(env);
  if (!material) {
    return null;
  }
  try {
    await compactVerify(token, material.key as JWTVerifyGetKey, {
      algorithms: material.algorithms,
    });
    return true;
  } catch {
    return false;
  }
};

// The verifier this environment describes. Total: every environment
// describes one, because an unconfigured environment describes the
// unverified one.
export const sessionVerifierFromEnv = (
  env: Env,
  logger: Logger = consoleLogger
): SessionVerifier => {
  switch (sessionSourceFromEnv(env)) {
    case 'jwks': {
      // createRemoteJWKSet caches the fetched keys (and coalesces refreshes),
      // so building it once per app is the cache.
      const jwks = createRemoteJWKSet(new URL(env[ESIGN_SESSION_JWKS_URL] as string));
      return verifyWith(jwks, env, JWKS_ALGORITHMS, logger);
    }
    case 'hs256': {
      const secret = env[ESIGN_SESSION_SECRET] as string;
      return verifyWith(new TextEncoder().encode(secret), env, ['HS256'], logger);
    }
    default:
      // No key material: the token is taken at face value. Said once at
      // boot by the banner, so there is nothing to warn about per request.
      return async (token) => token || null;
  }
};
