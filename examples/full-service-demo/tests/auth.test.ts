// Tests for JWT verification and the dev/prod authentication split

import crypto from 'crypto';
import { vi } from 'vitest';

import { getUserIdFromAuthHeader, resetDevPassthroughWarning, verifyJwt } from '../src/auth';

const TEST_SECRET = 'test-jwt-secret';

// Build a real HS256 JWT for testing
const createJwt = (
  payload: Record<string, unknown>,
  secret: string = TEST_SECRET,
  options: { tamperSignature?: boolean; corruptPayload?: boolean } = {}
): string => {
  const encode = (data: object) => Buffer.from(JSON.stringify(data)).toString('base64url');
  const header = encode({ alg: 'HS256', typ: 'JWT' });
  // Default to a valid future exp so tests that aren't about expiry get an
  // otherwise-valid token (exp is now required - see verifyJwt).
  const withExp =
    'exp' in payload ? payload : { exp: Math.floor(Date.now() / 1000) + 3600, ...payload };
  const body = options.corruptPayload
    ? Buffer.from('not-json{').toString('base64url')
    : encode(withExp);
  const signingInput = `${header}.${body}`;
  let signature = crypto.createHmac('sha256', secret).update(signingInput).digest('base64url');
  if (options.tamperSignature) {
    // Flip the first character (keeping length identical, so the check that
    // fails is the timing-safe comparison rather than the length guard)
    signature = (signature[0] === 'A' ? 'B' : 'A') + signature.slice(1);
  }
  return `${signingInput}.${signature}`;
};

describe('verifyJwt', () => {
  it('returns the sub claim for a valid token', () => {
    const token = createJwt({ sub: 'user-123' });
    expect(verifyJwt(token, TEST_SECRET)).toBe('user-123');
  });

  it('accepts a token with a future exp', () => {
    const token = createJwt({ sub: 'user-123', exp: Math.floor(Date.now() / 1000) + 3600 });
    expect(verifyJwt(token, TEST_SECRET)).toBe('user-123');
  });

  it('rejects an expired token', () => {
    const token = createJwt({ sub: 'user-123', exp: Math.floor(Date.now() / 1000) - 60 });
    expect(verifyJwt(token, TEST_SECRET)).toBeNull();
  });

  it('rejects a token that omits exp (would otherwise never expire)', () => {
    // Build a token whose payload has a sub but no exp
    const encode = (data: object) => Buffer.from(JSON.stringify(data)).toString('base64url');
    const header = encode({ alg: 'HS256', typ: 'JWT' });
    const body = encode({ sub: 'user-123' });
    const sig = crypto
      .createHmac('sha256', TEST_SECRET)
      .update(`${header}.${body}`)
      .digest('base64url');
    expect(verifyJwt(`${header}.${body}.${sig}`, TEST_SECRET)).toBeNull();
  });

  it('rejects a token signed with a different secret', () => {
    const token = createJwt({ sub: 'user-123' }, 'wrong-secret');
    expect(verifyJwt(token, TEST_SECRET)).toBeNull();
  });

  it('rejects a token with a tampered signature of the same length', () => {
    const token = createJwt({ sub: 'user-123' }, TEST_SECRET, { tamperSignature: true });
    expect(verifyJwt(token, TEST_SECRET)).toBeNull();
  });

  it('rejects a malformed token (wrong number of segments)', () => {
    expect(verifyJwt('not-a-jwt', TEST_SECRET)).toBeNull();
    expect(verifyJwt('one.two', TEST_SECRET)).toBeNull();
    expect(verifyJwt('one.two.three.four', TEST_SECRET)).toBeNull();
  });

  it('rejects a token whose sub is missing or empty', () => {
    expect(verifyJwt(createJwt({}), TEST_SECRET)).toBeNull();
    expect(verifyJwt(createJwt({ sub: '' }), TEST_SECRET)).toBeNull();
    expect(verifyJwt(createJwt({ sub: 42 }), TEST_SECRET)).toBeNull();
  });

  it('rejects a signature-valid token with an unparseable payload', () => {
    const token = createJwt({}, TEST_SECRET, { corruptPayload: true });
    expect(verifyJwt(token, TEST_SECRET)).toBeNull();
  });
});

describe('getUserIdFromAuthHeader', () => {
  const originalSecret = process.env.JWT_SECRET;
  const originalInsecureDev = process.env.ALLOW_INSECURE_DEV;

  afterEach(() => {
    if (originalSecret !== undefined) {
      process.env.JWT_SECRET = originalSecret;
    } else {
      delete process.env.JWT_SECRET;
    }
    if (originalInsecureDev !== undefined) {
      process.env.ALLOW_INSECURE_DEV = originalInsecureDev;
    } else {
      delete process.env.ALLOW_INSECURE_DEV;
    }
    resetDevPassthroughWarning();
  });

  it('returns null when no header is present', () => {
    expect(getUserIdFromAuthHeader(undefined)).toBeNull();
  });

  it('returns null for a non-Bearer header', () => {
    expect(getUserIdFromAuthHeader('Basic dXNlcjpwYXNz')).toBeNull();
  });

  it('returns null for a Bearer header with an empty token', () => {
    expect(getUserIdFromAuthHeader('Bearer ')).toBeNull();
  });

  describe('with JWT_SECRET configured', () => {
    beforeEach(() => {
      process.env.JWT_SECRET = TEST_SECRET;
    });

    it('returns the verified sub for a valid JWT', () => {
      const token = createJwt({ sub: 'user-123' });
      expect(getUserIdFromAuthHeader(`Bearer ${token}`)).toBe('user-123');
    });

    it('returns null for an invalid JWT (no passthrough when a secret is set)', () => {
      expect(getUserIdFromAuthHeader('Bearer opaque-user-id')).toBeNull();
    });
  });

  describe('without JWT_SECRET, insecure-dev allowed (passthrough)', () => {
    beforeEach(() => {
      delete process.env.JWT_SECRET;
      process.env.ALLOW_INSECURE_DEV = 'true';
    });

    it('treats the bearer token as the userId (passthrough)', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      expect(getUserIdFromAuthHeader('Bearer local-dev-user')).toBe('local-dev-user');
      warnSpy.mockRestore();
    });

    it('warns once, not on every request', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      getUserIdFromAuthHeader('Bearer user-a');
      getUserIdFromAuthHeader('Bearer user-b');

      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('JWT_SECRET not configured'));

      warnSpy.mockRestore();
    });
  });

  describe('without JWT_SECRET, insecure-dev NOT allowed (fail-closed)', () => {
    beforeEach(() => {
      delete process.env.JWT_SECRET;
      delete process.env.ALLOW_INSECURE_DEV;
    });

    it('treats every request as unauthenticated and logs an error - regardless of NODE_ENV', () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      expect(getUserIdFromAuthHeader('Bearer some-token')).toBeNull();
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('JWT_SECRET not configured'));

      errorSpy.mockRestore();
    });
  });
});
