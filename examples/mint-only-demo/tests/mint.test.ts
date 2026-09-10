import { vi } from 'vitest';

// createDocuSignProvider is replaced per test (the default is the real one),
// so the DocuSign entry can be asserted on without a network
const { createDocuSignProvider } = vi.hoisted(() => ({
  createDocuSignProvider: vi.fn(),
}));
vi.mock('@blinkbitcoin/esign-server', async importOriginal => {
  const original =
    await importOriginal<typeof import('@blinkbitcoin/esign-server')>();
  createDocuSignProvider.mockImplementation(original.createDocuSignProvider);
  return {
    ...original,
    createDocuSignProvider: (...args: unknown[]) =>
      createDocuSignProvider(...args),
  };
});

import { createMint, mockProvider, registry } from '../src/mint';

// Tests are silent (vitest.setup.ts): the webhook mirror logs its security
// events through the injected logger
const silent = { log() {}, warn() {}, error() {} };

describe('createMint', () => {
  afterEach(() => {
    createDocuSignProvider.mockClear();
  });

  it('mock provider: mints a URL onto the mock Web Forms page, remembering the prefill', async () => {
    const mint = createMint({
      ESIGN_PROVIDER: 'mock',
      MOCK_PAGES_ORIGIN: 'http://pages:4000',
    });
    const result = await mint('user-1', { number_of_units: 10 });
    expect(result.url).toMatch(/^http:\/\/pages:4000\/signing\/mock-webform\//);
    expect(result.instanceId).toBeDefined();
  });

  it('mock provider: defaults the pages origin to the full-service demo', async () => {
    const mint = createMint({ ESIGN_PROVIDER: 'mock' });
    expect((await mint('user-1', {})).url).toMatch(
      /^http:\/\/localhost:4100\//,
    );
  });

  it('mock provider: mirrors the DocuSign webhook verification (unsigned → rejected)', () => {
    const provider = mockProvider(
      { DOCUSIGN_HMAC_KEY: 'k' },
      { webhook: { logger: silent } },
    );
    expect(provider.verifyWebhook({}, '{}')).toBe(false);
  });

  it('docusign: is the default, refusing to start without the JWT-grant credentials', () => {
    expect(() => createMint({ ESIGN_PROVIDER: 'docusign' })).toThrow(
      /DOCUSIGN_/,
    );
    expect(() => createMint({})).toThrow(/DOCUSIGN_/);
  });

  it('docusign: mints through the DocuSign adapter over one config object', async () => {
    const env = {
      DOCUSIGN_ACCOUNT_ID: 'acc',
      DOCUSIGN_INTEGRATION_KEY: 'key',
      DOCUSIGN_USER_ID: 'uid',
      DOCUSIGN_PRIVATE_KEY: 'pem',
      DOCUSIGN_WEBFORM_ID: 'form',
      DOCUSIGN_HMAC_KEY: 'hmac',
    };
    const createHostedFormInstance = vi
      .fn()
      .mockResolvedValue({ url: 'https://f#instanceToken=T', instanceId: 'i' });
    createDocuSignProvider.mockReturnValueOnce({ createHostedFormInstance });
    const mint = createMint(env);
    await mint('user-2', { number_of_units: 1 });
    await mint('user-2', { number_of_units: 2 });
    expect(createDocuSignProvider).toHaveBeenCalledTimes(1);
    const [options] = createDocuSignProvider.mock.calls[0];
    expect(options.config).toMatchObject({ integrationKey: 'key' });
    expect(options.webhook.hmacKey()).toBe('hmac');
    expect(createHostedFormInstance).toHaveBeenNthCalledWith(1, 'user-2', {
      number_of_units: 1,
    });
    expect(createHostedFormInstance).toHaveBeenNthCalledWith(2, 'user-2', {
      number_of_units: 2,
    });
  });

  it('refuses a provider that cannot mint hosted forms', () => {
    const noForms = { ...mockProvider({}) };
    delete (noForms as { createHostedFormInstance?: unknown })
      .createHostedFormInstance;
    delete (noForms as { createWebFormInstance?: unknown })
      .createWebFormInstance;
    expect(() =>
      createMint({ ESIGN_PROVIDER: 'mock' }, { mock: () => noForms }),
    ).toThrow(/cannot mint hosted forms/);
  });

  it('registry: the package entries plus this host’s DocuSign entry', () => {
    expect(Object.keys(registry({})).sort()).toEqual(['docusign', 'mock']);
  });
});
