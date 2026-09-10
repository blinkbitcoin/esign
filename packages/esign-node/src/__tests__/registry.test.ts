// Provider selection: ESIGN_PROVIDER → a registry entry, lazily; the
// default registry wires the two shipped adapters from the environment.

import { silentLogger } from './support';
import {
  hostedFormMint,
  type ESignProvider,
  supportsHostedForms,
} from '../provider';
import {
  DOCUSIGN_DEMO_URLS,
  DocuSignConfigError,
  HOSTED_FORM_SETTINGS,
  JWT_CREDENTIALS,
} from '../providers/docusign/config';
import { ProductionConfigError } from '../production';
import {
  defaultRegistry,
  ESIGN_PROVIDER_ENV,
  hostedFormProviderFromEnv,
  type ProviderRegistry,
  providerFromEnv,
} from '../registry';

// The silent logger and the DocuSign settings the boot checks look at
const silent = silentLogger;
const webhook = { logger: silent };
const credentials = {
  DOCUSIGN_ACCOUNT_ID: 'acc',
  DOCUSIGN_INTEGRATION_KEY: 'key',
  DOCUSIGN_USER_ID: 'uid',
  DOCUSIGN_PRIVATE_KEY: 'pem',
  DOCUSIGN_WEBFORM_ID: 'form',
};

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
      /^http:\/\/localhost:4100\/signing\/mock-webform\//,
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

describe('defaultRegistry boot checks', () => {
  const hostedFormEnv = {
    ...credentials,
    DOCUSIGN_RETURN_URL: 'https://api.example.com/signing/return',
  };
  const productionHosts = {
    DOCUSIGN_BASE_URL: 'https://na1.docusign.net/restapi',
    DOCUSIGN_OAUTH_URL: 'https://account.docusign.com',
    DOCUSIGN_WEBFORMS_BASE_URL: 'https://apps.docusign.com/api/webforms/v1.1',
  };

  it('docusign: checks only the settings the host declares required, at selection', () => {
    expect(() => defaultRegistry({}).docusign()).not.toThrow();
    try {
      defaultRegistry(
        {},
        { docusign: { required: HOSTED_FORM_SETTINGS } },
      ).docusign();
      throw new Error('did not throw');
    } catch (error) {
      expect(error).toBeInstanceOf(DocuSignConfigError);
      expect((error as DocuSignConfigError).missing).toEqual([
        'DOCUSIGN_ACCOUNT_ID',
        'DOCUSIGN_INTEGRATION_KEY',
        'DOCUSIGN_PRIVATE_KEY',
        'DOCUSIGN_USER_ID',
        'DOCUSIGN_WEBFORM_ID',
        'DOCUSIGN_RETURN_URL',
      ]);
    }
    expect(() =>
      defaultRegistry(hostedFormEnv, {
        docusign: { required: HOSTED_FORM_SETTINGS },
      }).docusign(),
    ).not.toThrow();
  });

  it('mock: the DocuSign adapter it mirrors webhooks with stays unguarded', () => {
    const mock = defaultRegistry(
      { DOCUSIGN_HMAC_KEY: 'k' },
      { webhook, docusign: { required: HOSTED_FORM_SETTINGS } },
    ).mock();
    expect(mock.verifyWebhook({}, '{}')).toBe(false);
  });

  it('refuses the mock in production, unless demo is explicitly allowed', () => {
    const production = { ESIGN_ENV: 'production' };
    expect(() => defaultRegistry(production).mock()).toThrow(
      ProductionConfigError,
    );
    expect(() => defaultRegistry(production).mock()).toThrow(
      'ESIGN_ENV=production: the mock provider is a demo provider',
    );
    expect(() =>
      defaultRegistry({ ...production, ESIGN_ALLOW_DEMO: 'true' }).mock(),
    ).not.toThrow();
    expect(() => defaultRegistry({}).mock()).not.toThrow();
  });

  it('refuses DocuSign on the demo hosts in production, naming them', () => {
    const production = { ...hostedFormEnv, ESIGN_ENV: 'production' };
    expect(() => defaultRegistry(production).docusign()).toThrow(
      `ESIGN_ENV=production: DOCUSIGN_BASE_URL=${DOCUSIGN_DEMO_URLS.apiBaseUrl} is a demo host`,
    );
    expect(() =>
      defaultRegistry({ ...production, ...productionHosts }).docusign(),
    ).not.toThrow();
    expect(() =>
      defaultRegistry({ ...production, ESIGN_ALLOW_DEMO: 'true' }).docusign(),
    ).not.toThrow();
  });
});

describe('defaultRegistry private-key reader', () => {
  const fileEnv = {
    ...credentials,
    DOCUSIGN_PRIVATE_KEY: undefined,
    DOCUSIGN_PRIVATE_KEY_FILE: '/run/secrets/ds.pem',
    DOCUSIGN_RETURN_URL: 'https://api.example.com/signing/return',
  };

  it('reads the key through the injected reader, once per selection', async () => {
    const readFile = jest.fn().mockReturnValue('pem');
    const provider = defaultRegistry(fileEnv, {
      webhook,
      docusign: { required: HOSTED_FORM_SETTINGS, readFile },
    }).docusign();
    expect(readFile).toHaveBeenCalledWith('/run/secrets/ds.pem');
    expect(readFile).toHaveBeenCalledTimes(1);
    // Using the adapter reuses that configuration instead of re-reading it
    await expect(
      provider.createHostedFormInstance!('u', {}),
    ).rejects.toMatchObject({ extensions: { code: 'PROVIDER_UNAVAILABLE' } });
    expect(readFile).toHaveBeenCalledTimes(1);
  });
});

describe('hostedFormProviderFromEnv', () => {
  const hostedFormEnv = {
    ...credentials,
    DOCUSIGN_RETURN_URL: 'https://api.example.com/signing/return',
  };

  it('defaults to DocuSign and requires everything a hosted-form mint needs', () => {
    expect(() => hostedFormProviderFromEnv({})).toThrow(DocuSignConfigError);
    expect(() => hostedFormProviderFromEnv({})).toThrow(
      /DOCUSIGN_WEBFORM_ID, DOCUSIGN_RETURN_URL/,
    );
    const provider = hostedFormProviderFromEnv(hostedFormEnv);
    expect(supportsHostedForms(provider)).toBe(true);
  });

  it('lets a host without a return bridge declare its own required set', () => {
    expect(() =>
      hostedFormProviderFromEnv(credentials, {
        docusign: { required: JWT_CREDENTIALS },
      }),
    ).not.toThrow();
  });

  it('selects the mock when ESIGN_PROVIDER says so, and mints with it', async () => {
    const provider = hostedFormProviderFromEnv({
      ESIGN_PROVIDER: 'mock',
      MOCK_PAGES_ORIGIN: 'http://pages:4000',
    });
    const { url } = await hostedFormMint(provider)!('u', { units: 1 });
    expect(url).toMatch(/^http:\/\/pages:4000\/signing\/mock-webform\//);
  });

  it('takes the registry, the default entry and the webhook policy of defaultRegistry', async () => {
    const provider = hostedFormProviderFromEnv(
      { ESIGN_PROVIDER: 'mock' },
      {
        mockBaseUrl: () => 'http://svc:9',
        webhook: { ...webhook, allowMissingKey: () => true },
      },
    );
    expect(provider.verifyWebhook({}, '{}')).toBe(true);
    const { url } = await hostedFormMint(provider)!('u', {});
    expect(url).toMatch(/^http:\/\/svc:9\//);
  });

  it('threads the private-key reader through, keeping the hosted-form required set', () => {
    const readFile = jest.fn().mockReturnValue('pem');
    expect(() =>
      hostedFormProviderFromEnv(
        {
          ...credentials,
          DOCUSIGN_PRIVATE_KEY: undefined,
          DOCUSIGN_PRIVATE_KEY_FILE: '/run/secrets/ds.pem',
          DOCUSIGN_RETURN_URL: 'https://api.example.com/signing/return',
        },
        { docusign: { readFile } },
      ),
    ).not.toThrow();
    expect(readFile).toHaveBeenCalledWith('/run/secrets/ds.pem');
    // An explicit undefined does not defeat the default required set
    expect(() =>
      hostedFormProviderFromEnv({}, { docusign: { required: undefined } }),
    ).toThrow(DocuSignConfigError);
  });

  it('throws when the selected provider cannot mint hosted forms', () => {
    const noCapability = {
      none: () => ({}) as unknown as ESignProvider,
    };
    expect(() =>
      hostedFormProviderFromEnv(
        { ESIGN_PROVIDER: 'none' },
        { registry: noCapability, default: 'none' },
      ),
    ).toThrow('The selected provider cannot mint hosted forms');
  });
});
