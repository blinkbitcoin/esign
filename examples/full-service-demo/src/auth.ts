// Authentication: extracts the authenticated userId from an Authorization header.
//
// With JWT_SECRET configured: verifies an HS256 JWT (signature + expiry) and
// returns its `sub` claim. Invalid tokens resolve to null (unauthenticated).
//
// Without JWT_SECRET:
//   - production: fail closed - all requests are unauthenticated
//   - development: the bearer token is treated as an opaque userId, so local
//     clients and E2E tests work without an identity provider

import crypto from 'crypto';

import { isInsecureDevAllowed } from './config';

// Warn once (not per request) when running with the dev passthrough
let warnedDevPassthrough = false;

// Test helper: reset the warn-once flag between tests
export const resetDevPassthroughWarning = (): void => {
  warnedDevPassthrough = false;
};

// Verify an HS256 JWT and return its `sub` claim, or null if invalid.
// Signature is checked with a timing-safe comparison; the `alg` header is
// deliberately ignored (we only ever verify HS256 with our own secret, so
// forged alg values fail the signature check).
export const verifyJwt = (token: string, secret: string): string | null => {
  const parts = token.split('.');
  if (parts.length !== 3) {
    return null;
  }
  const [encodedHeader, encodedPayload, signature] = parts;

  const expectedSignature = crypto
    .createHmac('sha256', secret)
    .update(`${encodedHeader}.${encodedPayload}`)
    .digest('base64url');

  const signatureBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expectedSignature);
  if (
    signatureBuffer.length !== expectedBuffer.length ||
    !crypto.timingSafeEqual(signatureBuffer, expectedBuffer)
  ) {
    return null;
  }

  try {
    const payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8')) as {
      sub?: unknown;
      exp?: unknown;
    };

    // Require a numeric exp and enforce it: a token without expiry would be
    // valid forever (no revocation exists), so reject tokens that omit it.
    if (typeof payload.exp !== 'number' || payload.exp * 1000 < Date.now()) {
      return null; // Missing or past expiry
    }

    return typeof payload.sub === 'string' && payload.sub !== '' ? payload.sub : null;
  } catch {
    return null; // Signature-valid but unparseable payload (shouldn't happen)
  }
};

// Resolve the userId for a request from its Authorization header.
// Returns null for anything that isn't a well-formed `Bearer <token>` header.
export const getUserIdFromAuthHeader = (header: string | undefined): string | null => {
  if (!header?.startsWith('Bearer ')) {
    return null;
  }
  const token = header.slice('Bearer '.length);
  if (!token) {
    return null;
  }

  const secret = process.env.JWT_SECRET;
  if (!secret) {
    // Fail closed unless insecure-dev is explicitly opted into. This is NOT
    // gated on NODE_ENV - a missing/typo'd NODE_ENV must never open auth.
    // validateSecurityConfig() (config.ts) refuses to boot in this state
    // without ALLOW_INSECURE_DEV=true, so reaching here means it was allowed.
    if (!isInsecureDevAllowed()) {
      console.error('JWT_SECRET not configured - request treated as unauthenticated');
      return null;
    }
    // Dev passthrough: token is the userId (no identity provider available)
    if (!warnedDevPassthrough) {
      console.warn('⚠️ JWT_SECRET not configured - treating bearer token as userId (dev only)');
      warnedDevPassthrough = true;
    }
    return token;
  }

  return verifyJwt(token, secret);
};
