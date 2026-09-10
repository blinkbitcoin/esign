import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  assertDocuSignConfig,
  consentUrl,
  DOCUSIGN_DEMO_URLS,
  DOCUSIGN_ENV,
  DOCUSIGN_PRIVATE_KEY_SOURCES,
  DOCUSIGN_SCOPES,
  DocuSignConfigError,
  docuSignConfigFromEnv,
  docuSignDemoHostsInUse,
  HOSTED_FORM_SETTINGS,
  isDocuSignDemoHost,
  JWT_CREDENTIALS,
  missingDocuSignConfig,
  privateKeyFromEnv,
} from '../config';

const PEM =
  '-----BEGIN RSA PRIVATE KEY-----\nkey\n-----END RSA PRIVATE KEY-----';

describe('docuSignConfigFromEnv', () => {
  it('defaults to the demo environment with everything else unset', () => {
    expect(docuSignConfigFromEnv({})).toEqual({
      ...DOCUSIGN_DEMO_URLS,
      returnUrl: undefined,
      accountId: undefined,
      integrationKey: undefined,
      privateKey: undefined,
      userId: undefined,
      templateId: undefined,
      webFormId: undefined,
    });
  });

  it('reads every DOCUSIGN_* variable, treating empty strings as unset', () => {
    const env = {
      DOCUSIGN_BASE_URL: 'https://na1.docusign.net/restapi',
      DOCUSIGN_OAUTH_URL: 'https://account.docusign.com',
      DOCUSIGN_WEBFORMS_BASE_URL: 'https://apps.docusign.com/api/webforms/v1.1',
      DOCUSIGN_RETURN_URL: 'https://api.example.com/signing/return',
      DOCUSIGN_ACCOUNT_ID: 'acct',
      DOCUSIGN_INTEGRATION_KEY: 'key',
      DOCUSIGN_PRIVATE_KEY: 'pem',
      DOCUSIGN_USER_ID: 'user',
      DOCUSIGN_TEMPLATE_ID: '',
      DOCUSIGN_WEBFORM_ID: 'form',
    };
    expect(docuSignConfigFromEnv(env)).toEqual({
      apiBaseUrl: 'https://na1.docusign.net/restapi',
      oauthBaseUrl: 'https://account.docusign.com',
      webFormsBaseUrl: 'https://apps.docusign.com/api/webforms/v1.1',
      returnUrl: 'https://api.example.com/signing/return',
      accountId: 'acct',
      integrationKey: 'key',
      privateKey: 'pem',
      userId: 'user',
      templateId: undefined,
      webFormId: 'form',
    });
  });

  it('reads process.env by default', () => {
    process.env.DOCUSIGN_WEBFORM_ID = 'from-process-env';
    expect(docuSignConfigFromEnv().webFormId).toBe('from-process-env');
    delete process.env.DOCUSIGN_WEBFORM_ID;
  });

  it('names an environment variable for every setting', () => {
    for (const key of Object.keys(docuSignConfigFromEnv({}))) {
      expect(DOCUSIGN_ENV[key as keyof typeof DOCUSIGN_ENV]).toMatch(
        /^DOCUSIGN_/,
      );
    }
  });
});

describe('missingDocuSignConfig / assertDocuSignConfig', () => {
  it('lists the JWT credentials by default, as environment variable names', () => {
    expect(missingDocuSignConfig(docuSignConfigFromEnv({}))).toEqual([
      'DOCUSIGN_ACCOUNT_ID',
      'DOCUSIGN_INTEGRATION_KEY',
      'DOCUSIGN_PRIVATE_KEY',
      'DOCUSIGN_USER_ID',
    ]);
    expect(JWT_CREDENTIALS).toEqual([
      'accountId',
      'integrationKey',
      'privateKey',
      'userId',
    ]);
  });

  it('checks only the requested settings', () => {
    const config = docuSignConfigFromEnv({ DOCUSIGN_ACCOUNT_ID: 'acct' });
    expect(missingDocuSignConfig(config, ['accountId', 'webFormId'])).toEqual([
      'DOCUSIGN_WEBFORM_ID',
    ]);
    expect(() => assertDocuSignConfig(config, ['accountId'])).not.toThrow();
  });

  it('throws a DocuSignConfigError naming what is missing', () => {
    const config = docuSignConfigFromEnv({ DOCUSIGN_ACCOUNT_ID: 'acct' });
    expect(() => assertDocuSignConfig(config)).toThrow(DocuSignConfigError);
    try {
      assertDocuSignConfig(config, ['templateId', 'webFormId']);
    } catch (error) {
      expect(error).toBeInstanceOf(DocuSignConfigError);
      expect((error as DocuSignConfigError).missing).toEqual([
        'DOCUSIGN_TEMPLATE_ID',
        'DOCUSIGN_WEBFORM_ID',
      ]);
      expect((error as Error).message).toBe(
        'DocuSign: missing configuration: DOCUSIGN_TEMPLATE_ID, DOCUSIGN_WEBFORM_ID',
      );
      expect((error as Error).name).toBe('DocuSignConfigError');
    }
  });
});

describe('consentUrl', () => {
  it('asks for every scope the JWT grant uses, on the OAuth host, with the redirect encoded', () => {
    const url = new URL(
      consentUrl(
        {
          oauthBaseUrl: 'https://account-d.docusign.com',
          integrationKey: 'ik-1',
        },
        'http://localhost:4000',
      ),
    );
    expect(url.origin + url.pathname).toBe(
      'https://account-d.docusign.com/oauth/auth',
    );
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('scope')).toBe(DOCUSIGN_SCOPES);
    expect(url.searchParams.get('client_id')).toBe('ik-1');
    expect(url.searchParams.get('redirect_uri')).toBe('http://localhost:4000');
    expect(DOCUSIGN_SCOPES.split(' ')).toEqual(
      expect.arrayContaining([
        'signature',
        'impersonation',
        'webforms_instance_write',
      ]),
    );
  });

  it('tolerates a missing integration key (the config is validated elsewhere)', () => {
    expect(
      consentUrl(
        { oauthBaseUrl: 'https://o', integrationKey: undefined },
        'http://r',
      ),
    ).toContain('client_id=&');
  });
});

describe('privateKeyFromEnv', () => {
  const readFile = jest.fn();
  afterEach(() => {
    readFile.mockReset();
  });

  it('prefers the literal key, then base64, then the file', () => {
    readFile.mockReturnValue(`${PEM}-file`);
    const base64 = Buffer.from(`${PEM}-b64`).toString('base64');
    const all = {
      DOCUSIGN_PRIVATE_KEY: PEM,
      DOCUSIGN_PRIVATE_KEY_BASE64: base64,
      DOCUSIGN_PRIVATE_KEY_FILE: '/secrets/key.pem',
    };
    expect(privateKeyFromEnv(all, readFile)).toBe(PEM);
    expect(readFile).not.toHaveBeenCalled();

    expect(
      privateKeyFromEnv({ ...all, DOCUSIGN_PRIVATE_KEY: undefined }, readFile),
    ).toBe(`${PEM}-b64`);
    expect(readFile).not.toHaveBeenCalled();

    expect(
      privateKeyFromEnv(
        { DOCUSIGN_PRIVATE_KEY_FILE: '/secrets/key.pem' },
        readFile,
      ),
    ).toBe(`${PEM}-file`);
    expect(readFile).toHaveBeenCalledWith('/secrets/key.pem');
  });

  it('normalises literal \\n in every source and treats empty values as unset', () => {
    const escaped = PEM.replace(/\n/g, '\\n');
    expect(privateKeyFromEnv({ DOCUSIGN_PRIVATE_KEY: escaped }, readFile)).toBe(
      PEM,
    );
    expect(
      privateKeyFromEnv(
        {
          DOCUSIGN_PRIVATE_KEY_BASE64: Buffer.from(escaped).toString('base64'),
        },
        readFile,
      ),
    ).toBe(PEM);
    readFile.mockReturnValue(escaped);
    expect(
      privateKeyFromEnv({ DOCUSIGN_PRIVATE_KEY_FILE: '/k.pem' }, readFile),
    ).toBe(PEM);
    expect(
      privateKeyFromEnv(
        {
          DOCUSIGN_PRIVATE_KEY: '',
          DOCUSIGN_PRIVATE_KEY_BASE64: '',
          DOCUSIGN_PRIVATE_KEY_FILE: '',
        },
        readFile,
      ),
    ).toBeUndefined();
  });

  it('names the environment variable behind each source', () => {
    expect(DOCUSIGN_PRIVATE_KEY_SOURCES).toEqual({
      privateKey: 'DOCUSIGN_PRIVATE_KEY',
      base64: 'DOCUSIGN_PRIVATE_KEY_BASE64',
      file: 'DOCUSIGN_PRIVATE_KEY_FILE',
    });
  });

  it('reads the file from disk when no reader is injected', () => {
    const file = path.join(os.tmpdir(), `esign-key-${process.pid}.pem`);
    fs.writeFileSync(file, PEM);
    try {
      expect(privateKeyFromEnv({ DOCUSIGN_PRIVATE_KEY_FILE: file })).toBe(PEM);
    } finally {
      fs.unlinkSync(file);
    }
  });
});

describe('docuSignConfigFromEnv private-key sources', () => {
  it('takes the key from the file source through the injected reader', () => {
    const readFile = jest.fn().mockReturnValue(PEM);
    const config = docuSignConfigFromEnv(
      { DOCUSIGN_PRIVATE_KEY_FILE: '/secrets/key.pem' },
      { readFile },
    );
    expect(config.privateKey).toBe(PEM);
    expect(readFile).toHaveBeenCalledWith('/secrets/key.pem');
  });

  it('takes the key from the base64 source, normalised', () => {
    const escaped = PEM.replace(/\n/g, '\\n');
    expect(
      docuSignConfigFromEnv({
        DOCUSIGN_PRIVATE_KEY_BASE64: Buffer.from(escaped).toString('base64'),
      }).privateKey,
    ).toBe(PEM);
  });
});

describe('HOSTED_FORM_SETTINGS', () => {
  it('is the JWT grant plus the form and the return URL', () => {
    expect(HOSTED_FORM_SETTINGS).toEqual([
      ...JWT_CREDENTIALS,
      'webFormId',
      'returnUrl',
    ]);
    expect(
      missingDocuSignConfig(docuSignConfigFromEnv({}), HOSTED_FORM_SETTINGS),
    ).toEqual([
      'DOCUSIGN_ACCOUNT_ID',
      'DOCUSIGN_INTEGRATION_KEY',
      'DOCUSIGN_PRIVATE_KEY',
      'DOCUSIGN_USER_ID',
      'DOCUSIGN_WEBFORM_ID',
      'DOCUSIGN_RETURN_URL',
    ]);
  });
});

describe('isDocuSignDemoHost / docuSignDemoHostsInUse', () => {
  it('knows the developer hosts, including every DOCUSIGN_DEMO_URLS default', () => {
    for (const url of Object.values(DOCUSIGN_DEMO_URLS)) {
      expect(isDocuSignDemoHost(url)).toBe(true);
    }
    expect(isDocuSignDemoHost('https://demo.docusign.net/restapi')).toBe(true);
    expect(isDocuSignDemoHost('https://account-d.docusign.com')).toBe(true);
  });

  it('does not mistake a production host, a lookalike or a non-URL for a demo host', () => {
    expect(isDocuSignDemoHost('https://na1.docusign.net/restapi')).toBe(false);
    expect(isDocuSignDemoHost('https://account.docusign.com')).toBe(false);
    expect(isDocuSignDemoHost('https://demo.docusign.net.evil.com')).toBe(
      false,
    );
    expect(isDocuSignDemoHost('not a url')).toBe(false);
    expect(isDocuSignDemoHost(undefined)).toBe(false);
  });

  it('reports the demo hosts a config still uses as VAR=value', () => {
    expect(docuSignDemoHostsInUse(docuSignConfigFromEnv({}))).toEqual([
      `DOCUSIGN_BASE_URL=${DOCUSIGN_DEMO_URLS.apiBaseUrl}`,
      `DOCUSIGN_OAUTH_URL=${DOCUSIGN_DEMO_URLS.oauthBaseUrl}`,
      `DOCUSIGN_WEBFORMS_BASE_URL=${DOCUSIGN_DEMO_URLS.webFormsBaseUrl}`,
    ]);
    const production = docuSignConfigFromEnv({
      DOCUSIGN_BASE_URL: 'https://na1.docusign.net/restapi',
      DOCUSIGN_OAUTH_URL: 'https://account.docusign.com',
      DOCUSIGN_WEBFORMS_BASE_URL: 'https://apps.docusign.com/api/webforms/v1.1',
    });
    expect(docuSignDemoHostsInUse(production)).toEqual([]);
    expect(
      docuSignDemoHostsInUse({
        ...production,
        oauthBaseUrl: DOCUSIGN_DEMO_URLS.oauthBaseUrl,
      }),
    ).toEqual([`DOCUSIGN_OAUTH_URL=${DOCUSIGN_DEMO_URLS.oauthBaseUrl}`]);
  });
});
