// The locked-terms callback: the host computes what is actually minted from
// its own data, and its answer wins over anything the client sent.

import { vi } from 'vitest';

import {
  createEnvelopePrefillHook,
  createPrefillHook,
  DEFAULT_PREFILL_TIMEOUT_MS,
  PREFILL_FAILURE_MESSAGE,
  PrefillError,
  prefillConfigFromEnv,
} from '../src/prefill';

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

describe('prefillConfigFromEnv', () => {
  it('is undefined without ESIGN_PREFILL_URL', () => {
    expect(prefillConfigFromEnv({})).toBeUndefined();
  });

  it('reads the url, the shared secret and the timeout', () => {
    expect(
      prefillConfigFromEnv({
        ESIGN_PREFILL_URL: URL_,
        ESIGN_PREFILL_SECRET: 'shhh',
        ESIGN_PREFILL_TIMEOUT_MS: '250',
      })
    ).toEqual({ url: URL_, secret: 'shhh', timeoutMs: 250 });
  });

  it('defaults the timeout and leaves the secret unset', () => {
    expect(prefillConfigFromEnv({ ESIGN_PREFILL_URL: URL_ })).toEqual({
      url: URL_,
      secret: undefined,
      timeoutMs: DEFAULT_PREFILL_TIMEOUT_MS,
    });
  });

  it('falls back to the default for a non-numeric timeout', () => {
    expect(
      prefillConfigFromEnv({ ESIGN_PREFILL_URL: URL_, ESIGN_PREFILL_TIMEOUT_MS: 'soon' })?.timeoutMs
    ).toBe(DEFAULT_PREFILL_TIMEOUT_MS);
  });
});

describe('createPrefillHook', () => {
  it('posts the caller and the client input, and mints the reply', async () => {
    const fetchStub = replyWith({ prefill: { total_subscription_usd: '1000.00' } });
    const terms = createPrefillHook({ url: URL_, timeoutMs: 1000 }, { fetch: fetchStub });

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
    const terms = createPrefillHook({ url: URL_, timeoutMs: 1000 }, { fetch: fetchStub });

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
    const terms = createPrefillHook({ url: URL_, timeoutMs: 1000 }, { fetch: fetchStub });

    await expect(
      terms({ userId: 'user-1', prefill: { number_of_units: '9' }, request: request() })
    ).resolves.toEqual({ number_of_units: '9' });
  });

  it("forwards the caller's bearer token and the shared secret", async () => {
    const fetchStub = replyWith({ prefill: {} });
    const terms = createPrefillHook(
      { url: URL_, secret: 'shhh', timeoutMs: 1000 },
      { fetch: fetchStub }
    );

    await terms({ userId: 'u', prefill: {}, request: request('Bearer token-abc') });

    const headers = new Headers((fetchStub.mock.calls[0] as [string, RequestInit])[1].headers);
    expect(headers.get('authorization')).toBe('Bearer token-abc');
    expect(headers.get('x-esign-prefill-secret')).toBe('shhh');
    expect(headers.get('content-type')).toBe('application/json');
  });

  it('sends no authorization header when the caller had none', async () => {
    const fetchStub = replyWith({ prefill: {} });
    const terms = createPrefillHook({ url: URL_, timeoutMs: 1000 }, { fetch: fetchStub });

    await terms({ userId: 'u', prefill: {}, request: request() });

    const headers = new Headers((fetchStub.mock.calls[0] as [string, RequestInit])[1].headers);
    expect(headers.has('authorization')).toBe(false);
    expect(headers.has('x-esign-prefill-secret')).toBe(false);
  });

  it('fails on a non-2xx reply', async () => {
    const fetchStub = replyWith({ error: 'nope' }, 500);
    const terms = createPrefillHook({ url: URL_, timeoutMs: 1000 }, { fetch: fetchStub });

    await expect(terms({ userId: 'u', prefill: {}, request: request() })).rejects.toThrow(
      PrefillError
    );
  });

  it('fails when the transport does (timeout, DNS, connection refused)', async () => {
    const fetchStub = vi.fn(async () => {
      throw new DOMException('The operation was aborted.', 'TimeoutError');
    });
    const terms = createPrefillHook({ url: URL_, timeoutMs: 1 }, { fetch: fetchStub });

    await expect(terms({ userId: 'u', prefill: {}, request: request() })).rejects.toThrow(
      PREFILL_FAILURE_MESSAGE
    );
  });

  it('fails when the reply is not JSON', async () => {
    const fetchStub = vi.fn(async () => new Response('<html>oops</html>'));
    const terms = createPrefillHook({ url: URL_, timeoutMs: 1000 }, { fetch: fetchStub });

    await expect(terms({ userId: 'u', prefill: {}, request: request() })).rejects.toThrow(
      PrefillError
    );
  });

  it('fails when the reply carries no prefill (never mints the client values instead)', async () => {
    const fetchStub = replyWith({ ok: true });
    const terms = createPrefillHook({ url: URL_, timeoutMs: 1000 }, { fetch: fetchStub });

    await expect(terms({ userId: 'u', prefill: {}, request: request() })).rejects.toThrow(
      PrefillError
    );
  });

  it('aborts the call after the configured timeout', async () => {
    const fetchStub = vi.fn(async (_url: string, init: RequestInit) => {
      expect(init.signal).toBeInstanceOf(AbortSignal);
      return new Response(JSON.stringify({ prefill: {} }));
    });
    const terms = createPrefillHook({ url: URL_, timeoutMs: 1000 }, { fetch: fetchStub });

    await terms({ userId: 'u', prefill: {}, request: request() });
    expect(fetchStub).toHaveBeenCalled();
  });
});

describe('createPrefillHook without an injected fetch', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('uses the platform fetch', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ prefill: { units: '3' } })))
    );
    const terms = createPrefillHook({ url: URL_, timeoutMs: 1000 });

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
    const terms = createPrefillHook({ url: URL_, timeoutMs: 1000 });

    await expect(terms({ userId: 'u', prefill: {}, request: request() })).rejects.toThrow(
      PREFILL_FAILURE_MESSAGE
    );
  });
});

// The envelope spelling: the host is asked with the client's signer beside its
// prefill, and who signs is the host's to decide, like every value it locks
describe('createEnvelopePrefillHook', () => {
  // Synthetic signers - nothing here is anyone's data
  const signer = { name: 'Test Signer', email: 'signer@example.com' };
  const verified = { name: 'Verified Name', email: 'verified@example.com' };

  const envelopeRequest = (authorization?: string): Request =>
    new Request('https://api.example.com/envelope/instance', {
      method: 'POST',
      ...(authorization ? { headers: { authorization } } : {}),
    });

  afterEach(() => vi.unstubAllGlobals());

  // Unlike the Web Forms merge: on an envelope the lock travels with each
  // value, so a client entry the host did not name could lock a term the host
  // never computed. The client's values reach the host as input, and nothing
  // the host does not answer reaches the document.
  it('posts the caller, the client prefill and signer, and mints exactly the reply', async () => {
    const fetchStub = replyWith({
      recipient: verified,
      prefill: { total_usd: { value: '1000.00', locked: true } },
    });
    const terms = createEnvelopePrefillHook({ url: URL_, timeoutMs: 1000 }, { fetch: fetchStub });

    const minted = await terms({
      userId: 'user-1',
      recipient: signer,
      prefill: { total_usd: '1', notes: 'hi', fee_usd: { value: '0.00', locked: true } },
      request: envelopeRequest('Bearer token-abc'),
    });

    expect(minted).toEqual({
      recipient: verified,
      prefill: { total_usd: { value: '1000.00', locked: true } },
    });
    const [url, init] = fetchStub.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(URL_);
    expect(JSON.parse(init.body as string)).toEqual({
      userId: 'user-1',
      input: { total_usd: '1', notes: 'hi', fee_usd: { value: '0.00', locked: true } },
      recipient: signer,
    });
    expect(new Headers(init.headers).get('authorization')).toBe('Bearer token-abc');
  });

  // A reply naming no term leaves the template its own values: the same
  // envelope the no-callback path asks for, not one with an empty tab list
  it('mints the signer the host names and no prefill when it names no term', async () => {
    const terms = createEnvelopePrefillHook(
      { url: URL_, timeoutMs: 1000 },
      { fetch: replyWith({ prefill: {}, recipient: verified }) }
    );

    await expect(
      terms({ userId: 'u', recipient: signer, request: envelopeRequest() })
    ).resolves.toEqual({ recipient: verified, prefill: undefined });
  });

  it('asks with an empty input and no signer when the client sent neither', async () => {
    const fetchStub = replyWith({ prefill: {}, recipient: verified });
    const terms = createEnvelopePrefillHook({ url: URL_, timeoutMs: 1000 }, { fetch: fetchStub });

    await terms({ userId: 'u', request: envelopeRequest() });

    expect(
      JSON.parse((fetchStub.mock.calls[0] as [string, RequestInit])[1].body as string)
    ).toEqual({ userId: 'u', input: {} });
  });

  // Who signs is the host's to decide: a reply that names nobody must not
  // leave the caller's signer in force with the host's locked terms attached
  it('fails when the host names no signer', async () => {
    const terms = createEnvelopePrefillHook(
      { url: URL_, timeoutMs: 1000 },
      { fetch: replyWith({ prefill: {} }) }
    );

    await expect(
      terms({ userId: 'u', recipient: signer, request: envelopeRequest() })
    ).rejects.toThrow(PrefillError);
  });

  // A reply the envelope could not carry is a failure, never minted as sent
  it('fails on a prefill outside the envelope contract', async () => {
    const terms = createEnvelopePrefillHook(
      { url: URL_, timeoutMs: 1000 },
      { fetch: replyWith({ prefill: { total_usd: 1000 } }) }
    );

    await expect(
      terms({ userId: 'u', recipient: signer, request: envelopeRequest() })
    ).rejects.toThrow(PrefillError);
  });

  it('fails on a signer without a name and an email', async () => {
    for (const recipient of [{ name: 'Only A Name' }, 'verified@example.com', null, undefined]) {
      const terms = createEnvelopePrefillHook(
        { url: URL_, timeoutMs: 1000 },
        { fetch: replyWith({ prefill: {}, recipient }) }
      );

      await expect(
        terms({ userId: 'u', recipient: signer, request: envelopeRequest() })
      ).rejects.toThrow(PrefillError);
    }
  });

  it('fails as the Web Form terms do when the host does not answer', async () => {
    const terms = createEnvelopePrefillHook(
      { url: URL_, timeoutMs: 1000 },
      { fetch: replyWith({ error: 'nope' }, 500) }
    );

    await expect(terms({ userId: 'u', request: envelopeRequest() })).rejects.toThrow(
      PREFILL_FAILURE_MESSAGE
    );
  });

  it('holds the reply to the prefill contract it is given', async () => {
    const parsePrefill = vi.fn(() => ({ ok: false as const, error: 'host contract' }));
    const terms = createEnvelopePrefillHook(
      { url: URL_, timeoutMs: 1000 },
      { fetch: replyWith({ prefill: {} }), parsePrefill }
    );

    await expect(terms({ userId: 'u', request: envelopeRequest() })).rejects.toThrow(PrefillError);
    expect(parsePrefill).toHaveBeenCalledWith({});
  });

  it('uses the platform fetch when none is injected', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ prefill: {}, recipient: verified })))
    );
    const terms = createEnvelopePrefillHook({ url: URL_, timeoutMs: 1000 });

    await expect(
      terms({ userId: 'u', recipient: signer, request: envelopeRequest() })
    ).resolves.toEqual({ recipient: verified, prefill: undefined });
  });
});
