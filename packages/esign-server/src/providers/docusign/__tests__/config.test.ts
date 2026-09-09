import {
  assertDocuSignConfig,
  consentUrl,
  DOCUSIGN_DEMO_URLS,
  DOCUSIGN_ENV,
  DOCUSIGN_SCOPES,
  DocuSignConfigError,
  docuSignConfigFromEnv,
  JWT_CREDENTIALS,
  missingDocuSignConfig,
} from '../config';

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
