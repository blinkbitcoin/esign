// Session verification: the one place a caller's bearer token becomes a user
// id. JWKS (RS/ES via a remote key set), HS256 (a shared secret), or the
// explicit dev passthrough - selected by the environment alone.

import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { vi } from 'vitest';

import {
  resetDevPassthroughWarning,
  sessionSourceFromEnv,
  sessionVerifierFromEnv,
} from '../src/session';

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
  it('is jwks when SESSION_JWKS_URL is set', () => {
    expect(sessionSourceFromEnv({ SESSION_JWKS_URL: 'https://id.example.com/jwks' })).toBe('jwks');
  });

  it('is hs256 for SESSION_HS256_SECRET and for the JWT_SECRET alias', () => {
    expect(sessionSourceFromEnv({ SESSION_HS256_SECRET: 's' })).toBe('hs256');
    expect(sessionSourceFromEnv({ JWT_SECRET: 's' })).toBe('hs256');
  });

  it('prefers JWKS when both are configured', () => {
    expect(
      sessionSourceFromEnv({ SESSION_JWKS_URL: 'https://id.example.com/jwks', JWT_SECRET: 's' })
    ).toBe('jwks');
  });

  it('is the dev passthrough only with the explicit switch', () => {
    expect(sessionSourceFromEnv({ ALLOW_INSECURE_DEV: 'true' })).toBe('insecure');
    expect(sessionSourceFromEnv({ ALLOW_INSECURE_DEV: 'TRUE' })).toBeNull();
    expect(sessionSourceFromEnv({})).toBeNull();
  });
});

describe('sessionVerifierFromEnv', () => {
  afterEach(() => {
    resetDevPassthroughWarning();
    vi.restoreAllMocks();
  });

  it('refuses to build a verifier without a session source', () => {
    expect(() => sessionVerifierFromEnv({})).toThrow(/no session verification/i);
  });

  describe('HS256', () => {
    const verifier = () => sessionVerifierFromEnv({ SESSION_HS256_SECRET: HS256_SECRET });

    it('returns the sub of a valid token', async () => {
      await expect(verifier()(await signHs256({ sub: 'user-123' }))).resolves.toBe('user-123');
    });

    it('accepts the JWT_SECRET alias for the same secret', async () => {
      const aliased = sessionVerifierFromEnv({ JWT_SECRET: HS256_SECRET });
      await expect(aliased(await signHs256({ sub: 'user-123' }))).resolves.toBe('user-123');
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

    it('reads the user id from SESSION_USER_CLAIM when set', async () => {
      const claimed = sessionVerifierFromEnv({
        SESSION_HS256_SECRET: HS256_SECRET,
        SESSION_USER_CLAIM: 'uid',
      });
      await expect(claimed(await signHs256({ sub: 'ignored', uid: 'user-9' }))).resolves.toBe(
        'user-9'
      );
    });

    it('enforces SESSION_ISSUER and SESSION_AUDIENCE', async () => {
      const strict = sessionVerifierFromEnv({
        SESSION_HS256_SECRET: HS256_SECRET,
        SESSION_ISSUER: 'https://id.example.com',
        SESSION_AUDIENCE: 'esign',
      });
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
      const verify = sessionVerifierFromEnv({ SESSION_JWKS_URL: JWKS_URL });

      await expect(verify(await sign({ sub: 'user-123' }))).resolves.toBe('user-123');
    });

    it('caches the key set across calls (one fetch for two tokens)', async () => {
      const { sign, fetchStub } = await withKeys();
      const verify = sessionVerifierFromEnv({ SESSION_JWKS_URL: JWKS_URL });

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
      const otherVerify = sessionVerifierFromEnv({ SESSION_JWKS_URL: JWKS_URL });

      await expect(otherVerify(token)).resolves.toBeNull();
    });

    it('resolves to null when the key set cannot be fetched', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => new Response('nope', { status: 500 }))
      );
      const verify = sessionVerifierFromEnv({ SESSION_JWKS_URL: JWKS_URL });

      await expect(verify('a.b.c')).resolves.toBeNull();
    });
  });

  describe('dev passthrough', () => {
    it('treats the bearer token as the user id and warns once', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const verify = sessionVerifierFromEnv({ ALLOW_INSECURE_DEV: 'true' });

      await expect(verify('local-dev-user')).resolves.toBe('local-dev-user');
      await expect(verify('another-user')).resolves.toBe('another-user');

      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('ALLOW_INSECURE_DEV'));
    });

    it('still refuses an empty token', async () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      const verify = sessionVerifierFromEnv({ ALLOW_INSECURE_DEV: 'true' });

      await expect(verify('')).resolves.toBeNull();
    });
  });
});
