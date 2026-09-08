import { vi } from 'vitest';

const createWebFormInstance = vi.fn();
vi.mock('@blinkbitcoin/esign-server', async importOriginal => ({
  ...(await importOriginal<typeof import('@blinkbitcoin/esign-server')>()),
  createWebFormInstance: (...args: unknown[]) => createWebFormInstance(...args),
}));

import { createMint, mockProvider } from '../src/mint';

describe('createMint', () => {
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
      /^http:\/\/localhost:4000\//,
    );
  });

  it('mock provider: mirrors the DocuSign webhook verification (unsigned → rejected)', () => {
    const provider = mockProvider({ DOCUSIGN_HMAC_KEY: 'k' });
    expect(provider.verifyWebhook({}, '{}')).toBe(false);
  });

  it('docusign: refuses to start without the JWT-grant credentials', () => {
    expect(() => createMint({ ESIGN_PROVIDER: 'docusign' })).toThrow(
      /DOCUSIGN_/,
    );
  });

  it('docusign: mints through createWebFormInstance with one config object', async () => {
    const env = {
      DOCUSIGN_ACCOUNT_ID: 'acc',
      DOCUSIGN_INTEGRATION_KEY: 'key',
      DOCUSIGN_USER_ID: 'uid',
      DOCUSIGN_PRIVATE_KEY: 'pem',
      DOCUSIGN_WEBFORM_ID: 'form',
    };
    createWebFormInstance.mockResolvedValue({
      url: 'https://f#instanceToken=T',
      instanceId: 'i',
    });
    const mint = createMint(env);
    await mint('user-2', { number_of_units: 1 });
    await mint('user-2', { number_of_units: 2 });
    expect(createWebFormInstance).toHaveBeenCalledTimes(2);
    const [first, second] = createWebFormInstance.mock.calls.map(c => c[0]);
    expect(first).toMatchObject({
      userId: 'user-2',
      prefill: { number_of_units: 1 },
    });
    expect(first.config).toBe(second.config);
    expect(first.config).toMatchObject({ integrationKey: 'key' });
  });
});
