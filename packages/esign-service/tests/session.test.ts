// Session verification: the one place a caller's bearer token becomes a user
// id. JWKS (RS/ES via a remote key set), HS256 (a shared secret), or neither
// - in which case the token is taken at face value. Selected by the
// environment alone.

import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { vi } from 'vitest';

import { describeRejection, sessionSourceFromEnv, sessionVerifierFromEnv } from '../src/session';
import { silentLogger } from './support/app';

const HS256_SECRET = 'a-shared-session-secret-of-some-length';
const secretKey = () => new TextEncoder().encode(HS256_SECRET);

const signHs256 = async (
  claims: Record<string, unknown>,
  options: { expiresIn?: string; secret?: string } = {}
): Promise<string> => {
  const jwt = new SignJWT(claims).setProtectedHeader({ alg: 'HS256' }).setIssuedAt();
  if (options.expiresIn !== 'none') {
    jwt.setExpirationTime(options.expiresIn ?? '1h');
  }
  return jwt.sign(new TextEncoder().encode(options.secret ?? HS256_SECRET));
};

describe('sessionSourceFromEnv', () => {
  it('is jwks when ESIGN_SESSION_JWKS_URL is set', () => {
    expect(sessionSourceFromEnv({ ESIGN_SESSION_JWKS_URL: 'https://id.example.com/jwks' })).toBe(
      'jwks'
    );
  });

  it('is hs256 for ESIGN_SESSION_SECRET', () => {
    expect(sessionSourceFromEnv({ ESIGN_SESSION_SECRET: 's' })).toBe('hs256');
    expect(sessionSourceFromEnv({ ESIGN_SESSION_SECRET: 's' })).toBe('hs256');
  });

  it('prefers JWKS when both are configured', () => {
    expect(
      sessionSourceFromEnv({
        ESIGN_SESSION_JWKS_URL: 'https://id.example.com/jwks',
        ESIGN_SESSION_SECRET: 's',
      })
    ).toBe('jwks');
  });

  // Total: an unconfigured environment describes a source too, so no caller
  // has to handle "no source"
  it('is unverified when neither is configured', () => {
    expect(sessionSourceFromEnv({})).toBe('unverified');
  });
});

describe('sessionVerifierFromEnv', () => {
  afterEach(() => vi.restoreAllMocks());

  it('builds a verifier for every environment, configured or not', () => {
    expect(() => sessionVerifierFromEnv({})).not.toThrow();
  });

  describe('HS256', () => {
    const verifier = () =>
      sessionVerifierFromEnv({ ESIGN_SESSION_SECRET: HS256_SECRET }, silentLogger());

    it('returns the sub of a valid token', async () => {
      await expect(verifier()(await signHs256({ sub: 'user-123' }))).resolves.toBe('user-123');
    });

    it('rejects an expired token', async () => {
      const token = await new SignJWT({ sub: 'user-123' })
        .setProtectedHeader({ alg: 'HS256' })
        .setIssuedAt(Math.floor(Date.now() / 1000) - 7200)
        .setExpirationTime(Math.floor(Date.now() / 1000) - 3600)
        .sign(secretKey());
      await expect(verifier()(token)).resolves.toBeNull();
    });

    it('rejects a token signed with another secret', async () => {
      const token = await signHs256({ sub: 'user-123' }, { secret: 'another-secret-entirely' });
      await expect(verifier()(token)).resolves.toBeNull();
    });

    it('rejects a token without exp (it would never expire)', async () => {
      const token = await signHs256({ sub: 'user-123' }, { expiresIn: 'none' });
      await expect(verifier()(token)).resolves.toBeNull();
    });

    it('rejects garbage and an empty token', async () => {
      await expect(verifier()('not-a-jwt')).resolves.toBeNull();
      await expect(verifier()('')).resolves.toBeNull();
    });

    it('rejects a token whose user claim is missing or not a string', async () => {
      await expect(verifier()(await signHs256({}))).resolves.toBeNull();
      await expect(verifier()(await signHs256({ sub: '' }))).resolves.toBeNull();
      await expect(verifier()(await signHs256({ sub: 42 }))).resolves.toBeNull();
    });

    it('reads the user id from ESIGN_SESSION_USER_CLAIM when set', async () => {
      const claimed = sessionVerifierFromEnv(
        { ESIGN_SESSION_SECRET: HS256_SECRET, ESIGN_SESSION_USER_CLAIM: 'uid' },
        silentLogger()
      );
      await expect(claimed(await signHs256({ sub: 'ignored', uid: 'user-9' }))).resolves.toBe(
        'user-9'
      );
    });

    it('enforces ESIGN_SESSION_ISSUER and ESIGN_SESSION_AUDIENCE', async () => {
      const strict = sessionVerifierFromEnv(
        {
          ESIGN_SESSION_SECRET: HS256_SECRET,
          ESIGN_SESSION_ISSUER: 'https://id.example.com',
          ESIGN_SESSION_AUDIENCE: 'esign',
        },
        silentLogger()
      );
      const good = await signHs256({
        sub: 'user-123',
        iss: 'https://id.example.com',
        aud: 'esign',
      });
      await expect(strict(good)).resolves.toBe('user-123');

      const wrongIssuer = await signHs256({
        sub: 'user-123',
        iss: 'https://evil.example.com',
        aud: 'esign',
      });
      await expect(strict(wrongIssuer)).resolves.toBeNull();

      const wrongAudience = await signHs256({
        sub: 'user-123',
        iss: 'https://id.example.com',
        aud: 'other',
      });
      await expect(strict(wrongAudience)).resolves.toBeNull();
    });
  });

  describe('JWKS', () => {
    const JWKS_URL = 'https://id.example.com/.well-known/jwks.json';

    // A real RS256 key pair, its public half served as a JWKS by a stubbed
    // fetch - the verifier does the real signature check against it.
    const withKeys = async () => {
      const { publicKey, privateKey } = await generateKeyPair('RS256', { extractable: true });
      const jwk = { ...(await exportJWK(publicKey)), kid: 'test-key', alg: 'RS256', use: 'sig' };
      const fetchStub = vi.fn(async () => new Response(JSON.stringify({ keys: [jwk] })));
      vi.stubGlobal('fetch', fetchStub);
      const sign = (claims: Record<string, unknown>) =>
        new SignJWT(claims)
          .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
          .setIssuedAt()
          .setExpirationTime('1h')
          .sign(privateKey);
      return { sign, fetchStub };
    };

    afterEach(() => vi.unstubAllGlobals());

    it('returns the sub of a token signed by a key in the set', async () => {
      const { sign } = await withKeys();
      const verify = sessionVerifierFromEnv({ ESIGN_SESSION_JWKS_URL: JWKS_URL }, silentLogger());

      await expect(verify(await sign({ sub: 'user-123' }))).resolves.toBe('user-123');
    });

    it('caches the key set across calls (one fetch for two tokens)', async () => {
      const { sign, fetchStub } = await withKeys();
      const verify = sessionVerifierFromEnv({ ESIGN_SESSION_JWKS_URL: JWKS_URL }, silentLogger());

      await verify(await sign({ sub: 'user-1' }));
      await verify(await sign({ sub: 'user-2' }));

      expect(fetchStub).toHaveBeenCalledTimes(1);
    });

    it('rejects a token signed by a key outside the set', async () => {
      const { sign } = await withKeys();
      const token = await sign({ sub: 'user-123' });

      // A second, unrelated key set: the same token no longer verifies
      const other = await generateKeyPair('RS256', { extractable: true });
      const otherJwk = {
        ...(await exportJWK(other.publicKey)),
        kid: 'test-key',
        alg: 'RS256',
        use: 'sig',
      };
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => new Response(JSON.stringify({ keys: [otherJwk] })))
      );
      const otherVerify = sessionVerifierFromEnv(
        { ESIGN_SESSION_JWKS_URL: JWKS_URL },
        silentLogger()
      );

      await expect(otherVerify(token)).resolves.toBeNull();
    });

    it('resolves to null when the key set cannot be fetched', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => new Response('nope', { status: 500 }))
      );
      const verify = sessionVerifierFromEnv({ ESIGN_SESSION_JWKS_URL: JWKS_URL }, silentLogger());

      await expect(verify('a.b.c')).resolves.toBeNull();
    });
  });

  describe('unverified', () => {
    // Silently: the boot banner said this once already, so a per-request
    // warning would only be noise a deployment cannot act on
    it('treats the bearer token as the user id, without logging', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const verify = sessionVerifierFromEnv({});

      await expect(verify('local-dev-user')).resolves.toBe('local-dev-user');
      await expect(verify('another-user')).resolves.toBe('another-user');

      expect(warn).not.toHaveBeenCalled();
    });

    it('still refuses an empty token', async () => {
      await expect(sessionVerifierFromEnv({})('')).resolves.toBeNull();
    });
  });
});

// Why a token was rejected. All of these used to collapse into the same
// silent 401, which is what made ESIGN_SESSION_* effectively unconfigurable.
describe('describeRejection', () => {
  const joseError = (code: string, extra: Record<string, unknown> = {}) =>
    Object.assign(new Error(code), { code, ...extra });

  it('names both sides of an issuer mismatch', () => {
    expect(
      describeRejection(joseError('ERR_JWT_CLAIM_VALIDATION_FAILED', { claim: 'iss' }), {
        ESIGN_SESSION_ISSUER: 'https://id.example.com',
      })
    ).toEqual({
      cause: 'issuer',
      detail: expect.stringContaining('"https://id.example.com"'),
    });
  });

  it('mentions the trailing slash, because that is usually the bug', () => {
    const { detail } = describeRejection(
      joseError('ERR_JWT_CLAIM_VALIDATION_FAILED', { claim: 'iss' }),
      { ESIGN_SESSION_ISSUER: 'https://id.example.com' }
    );
    expect(detail).toContain('trailing slash');
  });

  it('names the audience variable on an audience mismatch', () => {
    expect(
      describeRejection(joseError('ERR_JWT_CLAIM_VALIDATION_FAILED', { claim: 'aud' }), {
        ESIGN_SESSION_AUDIENCE: 'esign',
      })
    ).toMatchObject({
      cause: 'audience',
      detail: expect.stringContaining('ESIGN_SESSION_AUDIENCE'),
    });
  });

  it('names a missing required claim', () => {
    expect(
      describeRejection(joseError('ERR_JWT_CLAIM_VALIDATION_FAILED', { claim: 'exp' }), {})
    ).toMatchObject({ cause: 'claim', detail: expect.stringContaining('exp') });
  });

  it('falls back to exp when jose names no claim', () => {
    expect(describeRejection(joseError('ERR_JWT_CLAIM_VALIDATION_FAILED'), {})).toMatchObject({
      cause: 'claim',
    });
  });

  it('calls an expired token expired', () => {
    expect(describeRejection(joseError('ERR_JWT_EXPIRED'), {}).cause).toBe('expired');
  });

  it.each(['ERR_JWS_SIGNATURE_VERIFICATION_FAILED', 'ERR_JWS_INVALID', 'ERR_JWT_INVALID'])(
    'calls %s a signature failure',
    (code) => {
      expect(describeRejection(joseError(code), {}).cause).toBe('signature');
    }
  );

  it('points at the key set when no key matches the kid', () => {
    expect(describeRejection(joseError('ERR_JWKS_NO_MATCHING_KEY'), {})).toMatchObject({
      cause: 'signature',
      detail: expect.stringContaining('ESIGN_SESSION_JWKS_URL'),
    });
  });

  it.each(['ERR_JWKS_TIMEOUT', 'ERR_JWKS_MULTIPLE_MATCHING_KEYS'])(
    'calls %s an unreachable key set',
    (code) => {
      expect(describeRejection(joseError(code), {}).cause).toBe('unreachable');
    }
  );

  it('describes something that is not a jose error at all', () => {
    expect(describeRejection('boom', {})).toEqual({ cause: 'signature', detail: 'boom' });
  });
});

describe('the verifier telling an operator why', () => {
  it('logs each distinct cause once, and still answers null', async () => {
    const logger = silentLogger();
    const verify = sessionVerifierFromEnv({ ESIGN_SESSION_SECRET: HS256_SECRET }, logger);

    await expect(verify('not-a-token')).resolves.toBeNull();
    await expect(verify('also-not-a-token')).resolves.toBeNull();

    // Once: a client retrying a bad token must not flood the log
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('token rejected'));
  });

  it('logs a second, different cause', async () => {
    const logger = silentLogger();
    const verify = sessionVerifierFromEnv({ ESIGN_SESSION_SECRET: HS256_SECRET }, logger);

    await verify('not-a-token');
    await verify(await signHs256({ sub: 'u1' }, { expiresIn: 'none' }));

    expect(logger.warn).toHaveBeenCalledTimes(2);
  });

  it('names the claim variable when the user id is not where it looked', async () => {
    const logger = silentLogger();
    const verify = sessionVerifierFromEnv({ ESIGN_SESSION_SECRET: HS256_SECRET }, logger);

    await expect(verify(await signHs256({ uid: 'u1' }))).resolves.toBeNull();

    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('ESIGN_SESSION_USER_CLAIM'));
    // Once only, like every other cause
    await verify(await signHs256({ uid: 'u2' }));
    expect(logger.warn).toHaveBeenCalledTimes(1);
  });

  it('says nothing when a token verifies', async () => {
    const logger = silentLogger();
    const verify = sessionVerifierFromEnv({ ESIGN_SESSION_SECRET: HS256_SECRET }, logger);

    await expect(verify(await signHs256({ sub: 'u1' }))).resolves.toBe('u1');

    expect(logger.warn).not.toHaveBeenCalled();
  });
});
