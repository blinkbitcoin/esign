// The locked-terms callback: the host computes what is actually minted from
// its own data, and its answer wins over anything the client sent.

import { vi } from 'vitest';

import {
  createTermsPrefill,
  DEFAULT_TERMS_TIMEOUT_MS,
  TERMS_FAILURE_MESSAGE,
  TermsError,
  termsConfigFromEnv,
} from '../src/terms';

const URL_ = 'https://host.example.com/esign/terms';

const request = (authorization?: string): Request =>
  new Request('https://api.example.com/webform/instance', {
    method: 'POST',
    ...(authorization ? { headers: { authorization } } : {}),
  });

// A fetch stub that answers with `body` (JSON) and records what it was called
// with
const replyWith = (body: unknown, status = 200) =>
  vi.fn(
    async () =>
      new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      })
  );

describe('termsConfigFromEnv', () => {
  it('is undefined without TERMS_URL', () => {
    expect(termsConfigFromEnv({})).toBeUndefined();
  });

  it('reads the url, the shared secret and the timeout', () => {
    expect(
      termsConfigFromEnv({
        TERMS_URL: URL_,
        TERMS_SHARED_SECRET: 'shhh',
        TERMS_TIMEOUT_MS: '250',
      })
    ).toEqual({ url: URL_, secret: 'shhh', timeoutMs: 250 });
  });

  it('defaults the timeout and leaves the secret unset', () => {
    expect(termsConfigFromEnv({ TERMS_URL: URL_ })).toEqual({
      url: URL_,
      secret: undefined,
      timeoutMs: DEFAULT_TERMS_TIMEOUT_MS,
    });
  });

  it('falls back to the default for a non-numeric timeout', () => {
    expect(termsConfigFromEnv({ TERMS_URL: URL_, TERMS_TIMEOUT_MS: 'soon' })?.timeoutMs).toBe(
      DEFAULT_TERMS_TIMEOUT_MS
    );
  });
});

describe('createTermsPrefill', () => {
  it('posts the caller and the client input, and mints the reply', async () => {
    const fetchStub = replyWith({ prefill: { total_subscription_usd: '1000.00' } });
    const terms = createTermsPrefill({ url: URL_, timeoutMs: 1000 }, { fetch: fetchStub });

    const prefill = await terms({
      userId: 'user-1',
      prefill: { number_of_units: '10' },
      request: request(),
    });

    expect(prefill).toEqual({ number_of_units: '10', total_subscription_usd: '1000.00' });
    const [url, init] = fetchStub.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(URL_);
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({
      userId: 'user-1',
      input: { number_of_units: '10' },
    });
  });

  it('lets the reply win key by key over the client values', async () => {
    const fetchStub = replyWith({ prefill: { number_of_units: '3' } });
    const terms = createTermsPrefill({ url: URL_, timeoutMs: 1000 }, { fetch: fetchStub });

    await expect(
      terms({
        userId: 'user-1',
        prefill: { number_of_units: '999', full_name: 'Ada' },
        request: request(),
      })
    ).resolves.toEqual({ number_of_units: '3', full_name: 'Ada' });
  });

  it('mints exactly the reply when it replaces every field', async () => {
    const fetchStub = replyWith({ prefill: {} });
    const terms = createTermsPrefill({ url: URL_, timeoutMs: 1000 }, { fetch: fetchStub });

    await expect(
      terms({ userId: 'user-1', prefill: { number_of_units: '9' }, request: request() })
    ).resolves.toEqual({ number_of_units: '9' });
  });

  it("forwards the caller's bearer token and the shared secret", async () => {
    const fetchStub = replyWith({ prefill: {} });
    const terms = createTermsPrefill(
      { url: URL_, secret: 'shhh', timeoutMs: 1000 },
      { fetch: fetchStub }
    );

    await terms({ userId: 'u', prefill: {}, request: request('Bearer token-abc') });

    const headers = new Headers((fetchStub.mock.calls[0] as [string, RequestInit])[1].headers);
    expect(headers.get('authorization')).toBe('Bearer token-abc');
    expect(headers.get('x-esign-terms-secret')).toBe('shhh');
    expect(headers.get('content-type')).toBe('application/json');
  });

  it('sends no authorization header when the caller had none', async () => {
    const fetchStub = replyWith({ prefill: {} });
    const terms = createTermsPrefill({ url: URL_, timeoutMs: 1000 }, { fetch: fetchStub });

    await terms({ userId: 'u', prefill: {}, request: request() });

    const headers = new Headers((fetchStub.mock.calls[0] as [string, RequestInit])[1].headers);
    expect(headers.has('authorization')).toBe(false);
    expect(headers.has('x-esign-terms-secret')).toBe(false);
  });

  it('fails on a non-2xx reply', async () => {
    const fetchStub = replyWith({ error: 'nope' }, 500);
    const terms = createTermsPrefill({ url: URL_, timeoutMs: 1000 }, { fetch: fetchStub });

    await expect(terms({ userId: 'u', prefill: {}, request: request() })).rejects.toThrow(
      TermsError
    );
  });

  it('fails when the transport does (timeout, DNS, connection refused)', async () => {
    const fetchStub = vi.fn(async () => {
      throw new DOMException('The operation was aborted.', 'TimeoutError');
    });
    const terms = createTermsPrefill({ url: URL_, timeoutMs: 1 }, { fetch: fetchStub });

    await expect(terms({ userId: 'u', prefill: {}, request: request() })).rejects.toThrow(
      TERMS_FAILURE_MESSAGE
    );
  });

  it('fails when the reply is not JSON', async () => {
    const fetchStub = vi.fn(async () => new Response('<html>oops</html>'));
    const terms = createTermsPrefill({ url: URL_, timeoutMs: 1000 }, { fetch: fetchStub });

    await expect(terms({ userId: 'u', prefill: {}, request: request() })).rejects.toThrow(
      TermsError
    );
  });

  it('fails when the reply carries no prefill (never mints the client values instead)', async () => {
    const fetchStub = replyWith({ ok: true });
    const terms = createTermsPrefill({ url: URL_, timeoutMs: 1000 }, { fetch: fetchStub });

    await expect(terms({ userId: 'u', prefill: {}, request: request() })).rejects.toThrow(
      TermsError
    );
  });

  it('aborts the call after the configured timeout', async () => {
    const fetchStub = vi.fn(async (_url: string, init: RequestInit) => {
      expect(init.signal).toBeInstanceOf(AbortSignal);
      return new Response(JSON.stringify({ prefill: {} }));
    });
    const terms = createTermsPrefill({ url: URL_, timeoutMs: 1000 }, { fetch: fetchStub });

    await terms({ userId: 'u', prefill: {}, request: request() });
    expect(fetchStub).toHaveBeenCalled();
  });
});

describe('createTermsPrefill without an injected fetch', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('uses the platform fetch', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ prefill: { units: '3' } })))
    );
    const terms = createTermsPrefill({ url: URL_, timeoutMs: 1000 });

    await expect(
      terms({ userId: 'u', prefill: { units: '1' }, request: request() })
    ).resolves.toEqual({ units: '3' });
  });

  it('reports a transport failure that is not an Error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw 'socket hang up';
      })
    );
    const terms = createTermsPrefill({ url: URL_, timeoutMs: 1000 });

    await expect(terms({ userId: 'u', prefill: {}, request: request() })).rejects.toThrow(
      TERMS_FAILURE_MESSAGE
    );
  });
});
