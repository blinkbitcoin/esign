// The diagnostic an operator runs instead of guessing.
//
// The point of every case here is that the report does NOT short-circuit:
// jwtVerify stops at the first failure, so someone fixing a configuration
// used to learn about one problem per deploy. One run must name them all.

import { SignJWT } from 'jose';
import { vi } from 'vitest';

import { checkPrefill, checkSession, formatCheck, runCheckCommand } from '../src/check';

const SECRET = 'a-shared-session-secret-of-some-length';
const key = () => new TextEncoder().encode(SECRET);

const sign = (claims: Record<string, unknown>, expiresIn = '1h') =>
  new SignJWT(claims)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(expiresIn)
    .sign(key());

const detailFor = (lines: Array<{ label: string; ok: boolean; detail: string }>, label: string) =>
  lines.find((entry) => entry.label === label);

describe('checkSession', () => {
  it('walks a good token through and passes every step', async () => {
    const lines = await checkSession(
      { ESIGN_SESSION_SECRET: SECRET },
      await sign({ sub: 'user_8812' })
    );
    expect(lines.every((entry) => entry.ok)).toBe(true);
    expect(detailFor(lines, 'user id')?.detail).toBe('sub = user_8812');
  });

  // The trailing slash: the most common real misconfiguration, and the one
  // that used to be completely invisible
  it('names both sides of an issuer mismatch', async () => {
    const lines = await checkSession(
      { ESIGN_SESSION_SECRET: SECRET, ESIGN_SESSION_ISSUER: 'https://id.example.com' },
      await sign({ sub: 'u1', iss: 'https://id.example.com/' })
    );
    const issuer = detailFor(lines, 'issuer');
    expect(issuer?.ok).toBe(false);
    expect(issuer?.detail).toContain('"https://id.example.com/"');
    expect(issuer?.detail).toContain('"https://id.example.com"');
  });

  // The defect this file caught: jwtVerify enforces the issuer in the same
  // call as the signature, so a wrong issuer used to report as a signature
  // failure - sending an operator to the wrong variable entirely
  it('calls a good signature verified even when the issuer is wrong', async () => {
    const lines = await checkSession(
      { ESIGN_SESSION_SECRET: SECRET, ESIGN_SESSION_ISSUER: 'https://id.example.com' },
      await sign({ sub: 'u1', iss: 'https://id.example.com/' })
    );
    expect(detailFor(lines, 'signature')).toMatchObject({ ok: true, detail: 'verified' });
    expect(detailFor(lines, 'issuer')?.ok).toBe(false);
  });

  it('calls a good signature verified even when the token has expired', async () => {
    const token = await new SignJWT({ sub: 'u1' })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt(Math.floor(Date.now() / 1000) - 7200)
      .setExpirationTime(Math.floor(Date.now() / 1000) - 3600)
      .sign(key());
    const lines = await checkSession({ ESIGN_SESSION_SECRET: SECRET }, token);
    expect(detailFor(lines, 'signature')?.ok).toBe(true);
    expect(detailFor(lines, 'expiry')?.ok).toBe(false);
  });

  // The whole reason this exists rather than a 401
  it('reports the audience too, even though the issuer already failed', async () => {
    const lines = await checkSession(
      {
        ESIGN_SESSION_SECRET: SECRET,
        ESIGN_SESSION_ISSUER: 'https://id.example.com',
        ESIGN_SESSION_AUDIENCE: 'esign',
      },
      await sign({ sub: 'u1', iss: 'https://wrong.example.com', aud: 'also-wrong' })
    );
    expect(detailFor(lines, 'issuer')?.ok).toBe(false);
    expect(detailFor(lines, 'audience')?.ok).toBe(false);
    expect(detailFor(lines, 'user id')?.ok).toBe(true);
  });

  it('accepts an audience the token carries among several', async () => {
    const lines = await checkSession(
      { ESIGN_SESSION_SECRET: SECRET, ESIGN_SESSION_AUDIENCE: 'esign' },
      await sign({ sub: 'u1', aud: ['other', 'esign'] })
    );
    expect(detailFor(lines, 'audience')?.ok).toBe(true);
  });

  it('says when an issuer or audience is not enforced at all', async () => {
    const lines = await checkSession({ ESIGN_SESSION_SECRET: SECRET }, await sign({ sub: 'u1' }));
    expect(detailFor(lines, 'issuer')?.detail).toContain('not enforced');
    expect(detailFor(lines, 'audience')?.detail).toContain('not enforced');
  });

  it('reports an expired token as expired, with how long ago', async () => {
    const token = await new SignJWT({ sub: 'u1' })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt(Math.floor(Date.now() / 1000) - 7200)
      .setExpirationTime(Math.floor(Date.now() / 1000) - 3600)
      .sign(key());
    const lines = await checkSession({ ESIGN_SESSION_SECRET: SECRET }, token);
    expect(detailFor(lines, 'expiry')).toMatchObject({
      ok: false,
      detail: expect.stringContaining('ago'),
    });
  });

  it('reports a token with no exp at all', async () => {
    const token = await new SignJWT({ sub: 'u1' })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .sign(key());
    const lines = await checkSession({ ESIGN_SESSION_SECRET: SECRET }, token);
    expect(detailFor(lines, 'expiry')?.detail).toContain('valid forever');
  });

  it('reports a wrong secret as a signature failure, and still reads the claims', async () => {
    const lines = await checkSession(
      { ESIGN_SESSION_SECRET: 'a-completely-different-secret-value' },
      await sign({ sub: 'u1' })
    );
    expect(detailFor(lines, 'signature')?.ok).toBe(false);
    // Decoding is not verification, so the claims still report
    expect(detailFor(lines, 'user id')?.ok).toBe(true);
  });

  it('names the claim to set when the user id is not where it looked', async () => {
    const lines = await checkSession({ ESIGN_SESSION_SECRET: SECRET }, await sign({ uid: 'u1' }));
    expect(detailFor(lines, 'user id')).toMatchObject({
      ok: false,
      detail: expect.stringContaining('ESIGN_SESSION_USER_CLAIM'),
    });
  });

  it('follows ESIGN_SESSION_USER_CLAIM when it is set', async () => {
    const lines = await checkSession(
      { ESIGN_SESSION_SECRET: SECRET, ESIGN_SESSION_USER_CLAIM: 'uid' },
      await sign({ uid: 'u1' })
    );
    expect(detailFor(lines, 'user id')?.detail).toBe('uid = u1');
  });

  it('stops at a token it cannot read', async () => {
    const lines = await checkSession({ ESIGN_SESSION_SECRET: SECRET }, 'not-a-jwt');
    expect(detailFor(lines, 'token')).toMatchObject({ ok: false });
    expect(detailFor(lines, 'signature')).toBeUndefined();
  });

  it('says the source is unconfigured, and does not claim the signature verified', async () => {
    const lines = await checkSession({}, await sign({ sub: 'u1' }));
    expect(detailFor(lines, 'source')?.ok).toBe(false);
    expect(detailFor(lines, 'signature')).toMatchObject({
      ok: false,
      detail: expect.stringContaining('no key material'),
    });
  });

  it('names the kid when the token header carries one', async () => {
    const token = await new SignJWT({ sub: 'u1' })
      .setProtectedHeader({ alg: 'HS256', kid: 'abc123' })
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(key());
    const lines = await checkSession({ ESIGN_SESSION_SECRET: SECRET }, token);
    expect(detailFor(lines, 'token')?.detail).toBe('HS256, kid abc123');
  });

  it('probes the key set for a JWKS deployment', async () => {
    const fetch = vi.fn(
      async () => new Response(JSON.stringify({ keys: [{ kid: 'k', alg: 'RS256' }] }))
    );
    const lines = await checkSession(
      { ESIGN_SESSION_JWKS_URL: 'https://id.example.com/jwks' },
      await sign({ sub: 'u1' }),
      { fetch }
    );
    expect(detailFor(lines, 'key set')).toMatchObject({ ok: true });
  });
});

describe('checkPrefill', () => {
  const URL_ = 'https://api.example.com/prefill';

  it('says when no callback is configured at all', async () => {
    const lines = await checkPrefill({});
    expect(lines).toEqual([
      { label: 'source', ok: false, detail: expect.stringContaining('ESIGN_PREFILL_URL unset') },
    ]);
  });

  it('reports a well-formed reply', async () => {
    const fetch = vi.fn(async () => Response.json({ prefill: { amount: '100', name: 'Ada' } }));
    const lines = await checkPrefill({ ESIGN_PREFILL_URL: URL_ }, { fetch });
    expect(detailFor(lines, 'reply')).toEqual({
      label: 'reply',
      ok: true,
      detail: 'prefill with 2 field(s)',
    });
  });

  it('sends the shared secret when one is configured', async () => {
    const fetch = vi.fn(async () => Response.json({ prefill: {} }));
    await checkPrefill({ ESIGN_PREFILL_URL: URL_, ESIGN_PREFILL_SECRET: 's' }, { fetch });
    const headers = (fetch.mock.calls[0][1] as RequestInit).headers as Record<string, string>;
    expect(headers['x-esign-prefill-secret']).toBe('s');
  });

  it('says when no secret is configured', async () => {
    const fetch = vi.fn(async () => Response.json({ prefill: {} }));
    const lines = await checkPrefill({ ESIGN_PREFILL_URL: URL_ }, { fetch });
    expect(detailFor(lines, 'secret')).toMatchObject({ ok: false });
  });

  it('reports a non-2xx answer', async () => {
    const fetch = vi.fn(async () => new Response('nope', { status: 404 }));
    const lines = await checkPrefill({ ESIGN_PREFILL_URL: URL_ }, { fetch });
    expect(detailFor(lines, 'reply')).toEqual({
      label: 'reply',
      ok: false,
      detail: 'answered 404',
    });
  });

  it('reports a body that is not JSON', async () => {
    const fetch = vi.fn(async () => new Response('<html>', { status: 200 }));
    const lines = await checkPrefill({ ESIGN_PREFILL_URL: URL_ }, { fetch });
    expect(detailFor(lines, 'reply')?.detail).toContain('did not answer with JSON');
  });

  it('reports a reply without a prefill object', async () => {
    const fetch = vi.fn(async () => Response.json({ values: {} }));
    const lines = await checkPrefill({ ESIGN_PREFILL_URL: URL_ }, { fetch });
    expect(detailFor(lines, 'reply')?.detail).toContain('without a prefill object');
  });

  it('reports a host that does not answer', async () => {
    const fetch = vi.fn(async () => {
      throw new Error('ECONNREFUSED');
    });
    const lines = await checkPrefill({ ESIGN_PREFILL_URL: URL_ }, { fetch });
    expect(detailFor(lines, 'reply')?.detail).toContain('ECONNREFUSED');
  });

  it('reports something thrown that is not an Error', async () => {
    const fetch = vi.fn(async () => {
      throw 'socket hang up';
    });
    const lines = await checkPrefill({ ESIGN_PREFILL_URL: URL_ }, { fetch });
    expect(detailFor(lines, 'reply')?.detail).toContain('socket hang up');
  });

  // The subcommand passes no fetch, so the global one is the real path
  it('falls back to the global fetch when none is injected', async () => {
    const global = vi.fn(async () => Response.json({ prefill: { a: '1' } }));
    vi.stubGlobal('fetch', global);
    try {
      const lines = await checkPrefill({ ESIGN_PREFILL_URL: URL_ });
      expect(global).toHaveBeenCalled();
      expect(detailFor(lines, 'reply')?.ok).toBe(true);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('formatCheck', () => {
  it('marks each line pass or fail', () => {
    expect(
      formatCheck([
        { label: 'issuer', ok: false, detail: 'mismatch' },
        { label: 'user id', ok: true, detail: 'sub = u1' },
      ])
    ).toBe('  ✗ issuer     mismatch\n  ✓ user id    sub = u1');
  });
});

// The command layer: node.ts only prints what this returns, so the exit code
// an operator's `&&` depends on is covered here rather than in a process.
describe('runCheckCommand', () => {
  const ok = vi.fn(async () => Response.json({ prefill: { amount: '1' } }));

  it('exits 0 when every line passes', async () => {
    const result = await runCheckCommand('check-session', [await sign({ sub: 'u1' })], {
      ESIGN_SESSION_SECRET: SECRET,
    });
    expect(result.code).toBe(0);
    expect(result.output).toContain('✓ user id');
  });

  it('exits 1 when any line fails', async () => {
    const result = await runCheckCommand('check-session', [await sign({ uid: 'u1' })], {
      ESIGN_SESSION_SECRET: SECRET,
    });
    expect(result.code).toBe(1);
    expect(result.output).toContain('✗ user id');
  });

  it('asks for a token when none was given', async () => {
    expect(await runCheckCommand('check-session', [], {})).toEqual({
      output: expect.stringContaining('usage:'),
      code: 1,
    });
  });

  it('runs the prefill check and exits 0 on a good reply', async () => {
    const result = await runCheckCommand(
      'check-prefill',
      [],
      { ESIGN_PREFILL_URL: 'https://api.example.com/prefill', ESIGN_PREFILL_SECRET: 's' },
      { fetch: ok }
    );
    expect(result.code).toBe(0);
  });

  it('exits 1 when the prefill callback is not configured', async () => {
    expect((await runCheckCommand('check-prefill', [], {})).code).toBe(1);
  });
});
