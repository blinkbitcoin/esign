/**
 * @format
 *
 * buildSource per ESIGN_MODE. The config module is replaced per test so both
 * branches run in one Jest process.
 */

const loadApp = (mode: 'proxy' | 'webform') => {
  let app!: typeof import('../App');
  jest.isolateModules(() => {
    jest.doMock('../src/config', () => ({
      ESIGN_MODE: mode,
      GRAPHQL_URL: 'http://localhost:4000/graphql',
      WEBFORM_INSTANCE_URL: 'http://localhost:4000/webform/instance',
    }));
    app = require('../App');
  });
  return app;
};

afterEach(() => {
  jest.restoreAllMocks();
  delete (globalThis as { fetch?: unknown }).fetch;
});

describe('buildSource', () => {
  it('proxy mode builds a restartable proxy source', () => {
    const { buildSource } = loadApp('proxy');
    const source = buildSource();
    expect(typeof source.start).toBe('function');
    expect(typeof (source as { restart?: unknown }).restart).toBe('function');
  });

  it('webform mode mints an instance URL from the backend with the prefill', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ url: 'https://forms.example/instance/1' }),
    });
    (globalThis as { fetch?: unknown }).fetch = fetchMock;

    const { buildSource } = loadApp('webform');
    const session = await buildSource().start();

    expect(session.url).toBe('https://forms.example/instance/1');
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:4000/webform/instance',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          prefill: { full_name: 'Test User', email: 'test@example.com' },
        }),
      }),
    );
  });

  it('webform mode surfaces a non-OK backend response as an error', async () => {
    (globalThis as { fetch?: unknown }).fetch = jest
      .fn()
      .mockResolvedValue({ ok: false, status: 503 });

    const { buildSource } = loadApp('webform');
    // The Web Forms source maps host errors to a SigningSourceError object
    await expect(buildSource().start()).rejects.toMatchObject({
      code: 'ENVELOPE_CREATION_FAILED',
      message: expect.stringMatching(/HTTP 503/),
    });
  });
});

describe('getRecipientData outside __DEV__', () => {
  it('returns an empty recipient', () => {
    const g = globalThis as unknown as { __DEV__: boolean };
    const prev = g.__DEV__;
    g.__DEV__ = false;
    try {
      const { getRecipientData } = loadApp('proxy');
      expect(getRecipientData()).toEqual({ name: '', email: '' });
    } finally {
      g.__DEV__ = prev;
    }
  });
});
