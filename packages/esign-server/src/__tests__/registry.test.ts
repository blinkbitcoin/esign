// Provider selection: ESIGN_PROVIDER → a registry entry, lazily; the
// default registry wires the two shipped adapters from the environment.

import { silentLogger } from './support';
import type { ESignProvider } from '../provider';
import {
  defaultRegistry,
  ESIGN_PROVIDER_ENV,
  type ProviderRegistry,
  providerFromEnv,
} from '../registry';

const stub = (name: string): ESignProvider =>
  ({ name }) as unknown as ESignProvider;

// A registry of two stubs that records which factories ran
const registry = (): { entries: ProviderRegistry; calls: string[] } => {
  const calls: string[] = [];
  const entry = (name: string) => () => {
    calls.push(name);
    return stub(name);
  };
  return {
    calls,
    entries: { docusign: entry('docusign'), mock: entry('mock') },
  };
};

describe('providerFromEnv', () => {
  let warn: jest.SpyInstance;
  beforeEach(() => {
    warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    warn.mockRestore();
  });

  it('selects the named entry and builds only that one', () => {
    const r = registry();
    expect(providerFromEnv({ ESIGN_PROVIDER: 'docusign' }, r.entries)).toEqual({
      name: 'docusign',
    });
    expect(r.calls).toEqual(['docusign']);
    expect(warn).not.toHaveBeenCalled();
    expect(ESIGN_PROVIDER_ENV).toBe('ESIGN_PROVIDER');
  });

  it('uses the default entry (mock) when the variable is unset, silently', () => {
    const r = registry();
    expect(providerFromEnv({}, r.entries)).toEqual({ name: 'mock' });
    expect(r.calls).toEqual(['mock']);
    expect(warn).not.toHaveBeenCalled();
  });

  it('takes another default', () => {
    const r = registry();
    expect(providerFromEnv({}, r.entries, { default: 'docusign' })).toEqual({
      name: 'docusign',
    });
    expect(warn).not.toHaveBeenCalled();
  });

  it('falls back to the default with one warning for an unknown name', () => {
    const r = registry();
    expect(providerFromEnv({ ESIGN_PROVIDER: 'adobe' }, r.entries)).toEqual({
      name: 'mock',
    });
    expect(r.calls).toEqual(['mock']);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      'Unknown ESIGN_PROVIDER: adobe, falling back to mock',
    );
  });

  it('treats an empty name as unknown', () => {
    expect(providerFromEnv({ ESIGN_PROVIDER: '' }, registry().entries)).toEqual(
      {
        name: 'mock',
      },
    );
    expect(warn).toHaveBeenCalledWith(
      'Unknown ESIGN_PROVIDER: , falling back to mock',
    );
  });

  it('never resolves a name through the registry prototype', () => {
    const r = registry();
    expect(
      providerFromEnv({ ESIGN_PROVIDER: 'constructor' }, r.entries),
    ).toEqual({
      name: 'mock',
    });
    expect(r.calls).toEqual(['mock']);
  });

  it('reports an unknown name through onUnknown instead of the console', () => {
    const onUnknown = jest.fn();
    providerFromEnv({ ESIGN_PROVIDER: 'adobe' }, registry().entries, {
      default: 'docusign',
      onUnknown,
    });
    expect(onUnknown).toHaveBeenCalledWith('adobe', 'docusign');
    expect(warn).not.toHaveBeenCalled();
  });
});

describe('defaultRegistry', () => {
  const silent = silentLogger;
  const webhook = { logger: silent };
  const credentials = {
    DOCUSIGN_ACCOUNT_ID: 'acc',
    DOCUSIGN_INTEGRATION_KEY: 'key',
    DOCUSIGN_USER_ID: 'uid',
    DOCUSIGN_PRIVATE_KEY: 'pem',
    DOCUSIGN_WEBFORM_ID: 'form',
  };

  it('mock: mints onto MOCK_PAGES_ORIGIN with no DocuSign settings at all', async () => {
    const provider = providerFromEnv(
      { ESIGN_PROVIDER: 'mock', MOCK_PAGES_ORIGIN: 'http://pages:4000' },
      defaultRegistry({
        ESIGN_PROVIDER: 'mock',
        MOCK_PAGES_ORIGIN: 'http://pages:4000',
      }),
    );
    const { url, instanceId } = await provider.createHostedFormInstance!('u', {
      units: 1,
    });
    expect(url).toBe(`http://pages:4000/signing/mock-webform/${instanceId}`);
    expect(provider.createWebFormInstance).toBe(
      provider.createHostedFormInstance,
    );
  });

  it('mock: defaults the pages origin to the esign service, or takes mockBaseUrl', async () => {
    const defaulted = await defaultRegistry({}).mock()
      .createHostedFormInstance!('u', {});
    expect(defaulted.url).toMatch(
      /^http:\/\/localhost:4000\/signing\/mock-webform\//,
    );
    const custom = await defaultRegistry(
      {},
      { mockBaseUrl: () => 'http://svc:9' },
    ).mock().createHostedFormInstance!('u', {});
    expect(custom.url).toMatch(/^http:\/\/svc:9\//);
  });

  it('mock: mirrors the DocuSign webhook policy (unsigned → rejected; allowMissingKey opens it)', () => {
    const strict = defaultRegistry(
      { DOCUSIGN_HMAC_KEY: 'k' },
      { webhook },
    ).mock();
    expect(strict.verifyWebhook({}, '{}')).toBe(false);
    const open = defaultRegistry(
      {},
      { webhook: { ...webhook, allowMissingKey: () => true } },
    ).mock();
    expect(open.verifyWebhook({}, '{}')).toBe(true);
    expect(open.parseWebhookEvent('nope')).toBeNull();
  });

  it('docusign: reads DOCUSIGN_* when selected and refuses unsigned webhooks', async () => {
    const env = { ...credentials, DOCUSIGN_HMAC_KEY: 'k' };
    const provider = providerFromEnv(
      { ESIGN_PROVIDER: 'docusign' },
      defaultRegistry(env, { webhook }),
    );
    expect(provider.verifyWebhook({}, '{}')).toBe(false);
    expect(provider.createWebFormInstance).toBe(
      provider.createHostedFormInstance,
    );
    // The configuration reaches the adapter: the form id gate passes and
    // the JWT grant is what fails (no real key), not a config check
    await expect(
      provider.createHostedFormInstance!('u', {}),
    ).rejects.toMatchObject({
      extensions: { code: 'PROVIDER_UNAVAILABLE' },
    });
  });

  it('docusign: the form id gate comes from the environment', async () => {
    const provider = defaultRegistry({
      ...credentials,
      DOCUSIGN_WEBFORM_ID: undefined,
    }).docusign();
    await expect(
      provider.createHostedFormInstance!('u', {}),
    ).rejects.toMatchObject({ extensions: { code: 'VALIDATION_ERROR' } });
  });
});
