// buildSource per ESIGN_MODE. The config module is replaced per test so all
// three branches run in one Vitest process.
import type { EsignMode } from '../config';

const loadApp = async (mode: EsignMode) => {
  vi.resetModules();
  vi.doMock('../config', () => ({
    ESIGN_MODE: mode,
    API_ORIGIN: 'http://localhost:4000',
    GRAPHQL_URL: 'http://localhost:4000/graphql',
    WEBFORM_INSTANCE_URL: 'http://localhost:4000/webform/instance',
    PUBLIC_FORM_URL: 'http://localhost:4000/signing/public-demo',
  }));
  return import('../App');
};

afterEach(() => {
  vi.doUnmock('../config');
  vi.unstubAllGlobals();
});

describe('buildSource', () => {
  it('proxy mode builds a restartable proxy source', async () => {
    const { buildSource } = await loadApp('proxy');
    const source = buildSource();
    expect(typeof (source as { restart?: unknown }).restart).toBe('function');
  });

  it('publicurl mode embeds the published form URL without a backend call', async () => {
    const { buildSource } = await loadApp('publicurl');
    const session = await buildSource().start();
    expect(session.url).toBe('http://localhost:4000/signing/public-demo');
  });

  it('webform mode mints an instance URL from the backend with the prefill', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ url: 'https://forms.example/instance/1' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const { buildSource } = await loadApp('webform');
    const session = await buildSource().start();

    expect(session.url).toBe('https://forms.example/instance/1');
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:4000/webform/instance',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          authorization: 'Bearer mock-jwt-token',
        }),
        body: JSON.stringify({
          prefill: { full_name: 'Test User', email: 'test@example.com' },
        }),
      }),
    );
  });

  it('webform mode surfaces a non-OK backend response as an error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 503 }),
    );
    const { buildSource } = await loadApp('webform');
    await expect(buildSource().start()).rejects.toMatchObject({
      code: 'ENVELOPE_CREATION_FAILED',
      message: expect.stringMatching(/HTTP 503/),
    });
  });
});
