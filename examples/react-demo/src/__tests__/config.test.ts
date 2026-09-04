// ESIGN_MODE is read from import.meta.env at module load, so each case
// re-imports the module with a stubbed env.
const load = async (mode?: string) => {
  vi.resetModules();
  if (mode === undefined) {
    vi.stubEnv('VITE_ESIGN_MODE', '');
  } else {
    vi.stubEnv('VITE_ESIGN_MODE', mode);
  }
  return import('../config');
};

afterEach(() => vi.unstubAllEnvs());

describe('config', () => {
  it('defaults to proxy mode', async () => {
    expect((await load()).ESIGN_MODE).toBe('proxy');
    expect((await load('bogus')).ESIGN_MODE).toBe('proxy');
  });

  it.each(['webform', 'publicurl'] as const)(
    'honors VITE_ESIGN_MODE=%s',
    async mode => {
      expect((await load(mode)).ESIGN_MODE).toBe(mode);
    },
  );

  it('derives every URL from the API origin', async () => {
    const c = await load();
    expect(c.GRAPHQL_URL).toBe(`${c.API_ORIGIN}/graphql`);
    expect(c.WEBFORM_INSTANCE_URL).toBe(`${c.API_ORIGIN}/webform/instance`);
    expect(c.PUBLIC_FORM_URL.startsWith(c.API_ORIGIN)).toBe(true);
  });
});
