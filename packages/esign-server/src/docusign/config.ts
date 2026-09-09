// DocuSign configuration: an explicit object (no hidden process.env reads in
// the client) plus the conventional DOCUSIGN_* environment mapping.

export interface DocuSignConfig {
  // eSignature REST base URL
  apiBaseUrl: string;
  // OAuth host (a different domain than the API)
  oauthBaseUrl: string;
  // Web Forms API base URL
  webFormsBaseUrl: string;
  // Default returnUrl for Web Forms instances (see WebFormInstanceOptions)
  returnUrl?: string;
  // JWT grant credentials
  accountId?: string;
  integrationKey?: string;
  // RSA private key, PEM
  privateKey?: string;
  // API user GUID the JWT impersonates
  userId?: string;
  // Envelope mode: the template to send
  templateId?: string;
  // Web Forms mode: the form to mint instances of
  webFormId?: string;
}

export type DocuSignConfigKey = keyof DocuSignConfig;

// The environment variable behind each setting
export const DOCUSIGN_ENV: Record<DocuSignConfigKey, string> = {
  apiBaseUrl: 'DOCUSIGN_BASE_URL',
  oauthBaseUrl: 'DOCUSIGN_OAUTH_URL',
  webFormsBaseUrl: 'DOCUSIGN_WEBFORMS_BASE_URL',
  returnUrl: 'DOCUSIGN_RETURN_URL',
  accountId: 'DOCUSIGN_ACCOUNT_ID',
  integrationKey: 'DOCUSIGN_INTEGRATION_KEY',
  privateKey: 'DOCUSIGN_PRIVATE_KEY',
  userId: 'DOCUSIGN_USER_ID',
  templateId: 'DOCUSIGN_TEMPLATE_ID',
  webFormId: 'DOCUSIGN_WEBFORM_ID',
};

// The developer (demo) environment; production hosts differ
export const DOCUSIGN_DEMO_URLS = {
  apiBaseUrl: 'https://demo.docusign.net/restapi',
  oauthBaseUrl: 'https://account-d.docusign.com',
  webFormsBaseUrl: 'https://apps-d.docusign.com/api/webforms/v1.1',
} as const;

// What the JWT grant needs before any call can be made
export const JWT_CREDENTIALS: readonly DocuSignConfigKey[] = [
  'accountId',
  'integrationKey',
  'privateKey',
  'userId',
];

export type Env = Record<string, string | undefined>;

// Read the DOCUSIGN_* variables (defaults to the demo environment URLs)
// The OAuth scopes the JWT grant asks for: eSignature (envelopes, embedded
// signing) plus the Web Forms API (read a form, mint and read instances).
// The one-time consent must cover the same set (see consentUrl).
export const DOCUSIGN_SCOPES =
  'signature impersonation webforms_read webforms_instance_read webforms_instance_write';

// The URL a human opens once to grant this integration key consent to
// impersonate the user with DOCUSIGN_SCOPES. redirectUri must be registered
// on the integration key; it is never used at runtime.
export const consentUrl = (
  config: Pick<DocuSignConfig, 'oauthBaseUrl' | 'integrationKey'>,
  redirectUri: string,
): string =>
  `${config.oauthBaseUrl}/oauth/auth?response_type=code&scope=${encodeURIComponent(DOCUSIGN_SCOPES)}&client_id=${config.integrationKey ?? ''}&redirect_uri=${encodeURIComponent(redirectUri)}`;

export const docuSignConfigFromEnv = (
  env: Env = process.env,
): DocuSignConfig => ({
  apiBaseUrl: env[DOCUSIGN_ENV.apiBaseUrl] || DOCUSIGN_DEMO_URLS.apiBaseUrl,
  oauthBaseUrl:
    env[DOCUSIGN_ENV.oauthBaseUrl] || DOCUSIGN_DEMO_URLS.oauthBaseUrl,
  webFormsBaseUrl:
    env[DOCUSIGN_ENV.webFormsBaseUrl] || DOCUSIGN_DEMO_URLS.webFormsBaseUrl,
  returnUrl: env[DOCUSIGN_ENV.returnUrl] || undefined,
  accountId: env[DOCUSIGN_ENV.accountId] || undefined,
  integrationKey: env[DOCUSIGN_ENV.integrationKey] || undefined,
  privateKey: env[DOCUSIGN_ENV.privateKey] || undefined,
  userId: env[DOCUSIGN_ENV.userId] || undefined,
  templateId: env[DOCUSIGN_ENV.templateId] || undefined,
  webFormId: env[DOCUSIGN_ENV.webFormId] || undefined,
});

// The environment variable names of the required settings that are unset
export const missingDocuSignConfig = (
  config: DocuSignConfig,
  required: readonly DocuSignConfigKey[] = JWT_CREDENTIALS,
): string[] =>
  required.filter(key => !config[key]).map(key => DOCUSIGN_ENV[key]);

// A setting the requested operation cannot do without
export class DocuSignConfigError extends Error {
  constructor(public readonly missing: string[]) {
    super(`DocuSign: missing configuration: ${missing.join(', ')}`);
    this.name = 'DocuSignConfigError';
  }
}

// Throw a DocuSignConfigError unless every required setting is present
export const assertDocuSignConfig = (
  config: DocuSignConfig,
  required: readonly DocuSignConfigKey[] = JWT_CREDENTIALS,
): void => {
  const missing = missingDocuSignConfig(config, required);
  if (missing.length > 0) {
    throw new DocuSignConfigError(missing);
  }
};
