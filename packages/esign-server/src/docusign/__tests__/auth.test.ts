import { createJwtAssertion, createTokenProvider, defaultFetch } from '../auth';
import { DocuSignConfigError } from '../config';
import { HttpError } from '../../http';
import {
  fail,
  fakeFetch,
  testConfig,
  token,
  verifyJwt,
} from '../../__tests__/support';

describe('createJwtAssertion', () => {
  it('signs an RS256 assertion with the grant claims', () => {
    const now = 1_800_000_000_000;
    const jwt = createJwtAssertion(testConfig(), now);
    const [header] = jwt.split('.');
    expect(JSON.parse(Buffer.from(header, 'base64url').toString())).toEqual({
      alg: 'RS256',
      typ: 'JWT',
    });
    expect(verifyJwt(jwt)).toEqual({
      iss: 'ik-1',
      sub: 'user-1',
      aud: 'account-d.docusign.com',
      iat: 1_800_000_000,
      exp: 1_800_003_600,
      scope:
        'signature impersonation webforms_read webforms_instance_read webforms_instance_write',
    });
  });

  it('defaults to the current time', () => {
    const before = Math.floor(Date.now() / 1000);
    const payload = verifyJwt(createJwtAssertion(testConfig()));
    expect(payload.iat as number).toBeGreaterThanOrEqual(before);
  });

  it('refuses to sign without the credentials', () => {
    expect(() =>
      createJwtAssertion(testConfig({ privateKey: undefined })),
    ).toThrow(DocuSignConfigError);
    expect(() =>
      createJwtAssertion(testConfig({ integrationKey: undefined })),
    ).toThrow('DOCUSIGN_INTEGRATION_KEY');
  });
});

describe('createTokenProvider', () => {
  it('exchanges the assertion for a token at the OAuth host', async () => {
    const { fetchImpl, calls } = fakeFetch([token('abc')]);
    const provider = createTokenProvider(testConfig(), fetchImpl);
    expect(await provider.getAccessToken()).toBe('abc');
    expect(calls[0].url).toBe('https://account-d.docusign.com/oauth/token');
    expect(calls[0].init?.method).toBe('POST');
    const body = calls[0].init?.body as URLSearchParams;
    expect(body.get('grant_type')).toBe(
      'urn:ietf:params:oauth:grant-type:jwt-bearer',
    );
    expect(verifyJwt(body.get('assertion') as string).iss).toBe('ik-1');
  });

  it('caches the token and refreshes it inside the 5-minute margin', async () => {
    const { fetchImpl, calls } = fakeFetch([
      token('first', 3600),
      token('second', 3600),
    ]);
    const provider = createTokenProvider(testConfig(), fetchImpl);
    expect(await provider.getAccessToken()).toBe('first');
    expect(await provider.getAccessToken()).toBe('first');
    expect(calls).toHaveLength(1);

    const now = jest
      .spyOn(Date, 'now')
      .mockReturnValue(Date.now() + 3600 * 1000 - 60 * 1000);
    expect(await provider.getAccessToken()).toBe('second');
    expect(calls).toHaveLength(2);
    now.mockRestore();
  });

  it('shares one in-flight refresh between concurrent callers', async () => {
    const { fetchImpl, calls } = fakeFetch([token('shared')]);
    const provider = createTokenProvider(testConfig(), fetchImpl);
    const [a, b] = await Promise.all([
      provider.getAccessToken(),
      provider.getAccessToken(),
    ]);
    expect(a).toBe('shared');
    expect(b).toBe('shared');
    expect(calls).toHaveLength(1);
  });

  it('surfaces a failed exchange as HttpError and does not cache it', async () => {
    const { fetchImpl, calls } = fakeFetch([
      fail(401, 'consent_required'),
      token('later'),
    ]);
    const provider = createTokenProvider(testConfig(), fetchImpl);
    await expect(provider.getAccessToken()).rejects.toEqual(
      new HttpError(401, 'consent_required'),
    );
    expect(await provider.getAccessToken()).toBe('later');
    expect(calls).toHaveLength(2);
  });

  it('forgets the token on clearTokenCache', async () => {
    const { fetchImpl, calls } = fakeFetch([token('a'), token('b')]);
    const provider = createTokenProvider(testConfig(), fetchImpl);
    await provider.getAccessToken();
    provider.clearTokenCache();
    expect(await provider.getAccessToken()).toBe('b');
    expect(calls).toHaveLength(2);
  });

  it('uses the global fetch by default, resolved at call time', async () => {
    const original = globalThis.fetch;
    const spy = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ access_token: 'global', expires_in: 3600 }),
    });
    globalThis.fetch = spy as unknown as typeof fetch;
    const provider = createTokenProvider(testConfig());
    expect(await provider.getAccessToken()).toBe('global');
    expect(spy).toHaveBeenCalledTimes(1);
    globalThis.fetch = original;
    expect(typeof defaultFetch).toBe('function');
  });
});
