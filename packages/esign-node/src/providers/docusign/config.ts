// DocuSign configuration: an explicit object (no hidden process.env reads in
// the client) plus the conventional DOCUSIGN_* environment mapping.

import { readFileSync } from 'node:fs';

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
  // Envelope mode: the template to send, or several separated by commas. Several
  // go out as ONE envelope, their documents in the order listed, so an agreement
  // made of more than one document is signed in a single session (the signer
  // role must sit at the same routing order in each). `templateIds(config)`
  // reads the list; docuSignConfigFromEnv stores it trimmed, blanks dropped.
  templateId?: string;
  // Envelope mode: the template role the signer fills. Templates name their roles
  // for the agreement they carry ("investor", "tenant", "employee"), so the one
  // this host sends to is configuration, not a constant.
  signerRoleName?: string;
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
  signerRoleName: 'DOCUSIGN_SIGNER_ROLE',
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

// What minting a hosted-form (Web Forms) instance needs on top of the grant:
// the form to mint, and the returnUrl the signing bridge comes back to
export const HOSTED_FORM_SETTINGS: readonly DocuSignConfigKey[] = [
  ...JWT_CREDENTIALS,
  'webFormId',
  'returnUrl',
];

export type Env = Record<string, string | undefined>;

// Where the RSA private key may come from, in precedence order: the PEM
// itself, the same PEM base64-encoded (one-line env values), or a file
// (a mounted Docker/Kubernetes secret).
export const DOCUSIGN_PRIVATE_KEY_SOURCES = {
  privateKey: DOCUSIGN_ENV.privateKey,
  base64: 'DOCUSIGN_PRIVATE_KEY_BASE64',
  file: 'DOCUSIGN_PRIVATE_KEY_FILE',
} as const;

// How the file source is read; injectable so callers (and tests) decide
// whether the disk is touched at all
export type ReadFile = (path: string) => string;

const readFileUtf8: ReadFile = path => readFileSync(path, 'utf8');

// A mounted secret that is missing or unreadable is a configuration
// problem, so say which variable and which path - never the key material
const readPrivateKeyFile = (file: string, readFile: ReadFile): string => {
  try {
    return readFile(file);
  } catch (error) {
    throw new Error(
      `${DOCUSIGN_PRIVATE_KEY_SOURCES.file}=${file}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
};

// A PEM pasted into a one-line environment variable arrives with literal
// backslash-n; node:crypto needs real newlines.
const normalizePem = (key: string): string => key.replace(/\\n/g, '\n');

// The private key of the first source that is set, or undefined. Empty
// values count as unset, like every other setting.
export const privateKeyFromEnv = (
  env: Env,
  readFile: ReadFile = readFileUtf8,
): string | undefined => {
  const literal = env[DOCUSIGN_PRIVATE_KEY_SOURCES.privateKey];
  if (literal) {
    return normalizePem(literal);
  }
  const base64 = env[DOCUSIGN_PRIVATE_KEY_SOURCES.base64];
  if (base64) {
    return normalizePem(Buffer.from(base64, 'base64').toString('utf8'));
  }
  const file = env[DOCUSIGN_PRIVATE_KEY_SOURCES.file];
  return file ? normalizePem(readPrivateKeyFile(file, readFile)) : undefined;
};

export interface DocuSignConfigFromEnvOptions {
  // How DOCUSIGN_PRIVATE_KEY_FILE is read (default: node:fs readFileSync)
  readFile?: ReadFile;
}

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
  options: DocuSignConfigFromEnvOptions = {},
): DocuSignConfig => ({
  apiBaseUrl: env[DOCUSIGN_ENV.apiBaseUrl] || DOCUSIGN_DEMO_URLS.apiBaseUrl,
  oauthBaseUrl:
    env[DOCUSIGN_ENV.oauthBaseUrl] || DOCUSIGN_DEMO_URLS.oauthBaseUrl,
  webFormsBaseUrl:
    env[DOCUSIGN_ENV.webFormsBaseUrl] || DOCUSIGN_DEMO_URLS.webFormsBaseUrl,
  returnUrl: env[DOCUSIGN_ENV.returnUrl] || undefined,
  accountId: env[DOCUSIGN_ENV.accountId] || undefined,
  integrationKey: env[DOCUSIGN_ENV.integrationKey] || undefined,
  privateKey: privateKeyFromEnv(env, options.readFile),
  userId: env[DOCUSIGN_ENV.userId] || undefined,
  // Normalised once here, so a value that names no template (a lone comma)
  // is unset to the boot guard, the assertions and the client alike
  templateId:
    templateIds({ templateId: env[DOCUSIGN_ENV.templateId] }).join(',') ||
    undefined,
  signerRoleName: env[DOCUSIGN_ENV.signerRoleName] || undefined,
  webFormId: env[DOCUSIGN_ENV.webFormId] || undefined,
});

// The templates `templateId` names, in the order the signer reads them. Blank
// entries are dropped, so a trailing comma or the spaces after one cannot add
// a template nobody asked for.
export const templateIds = (
  config: Pick<DocuSignConfig, 'templateId'>,
): string[] =>
  (config.templateId ?? '')
    .split(',')
    .map(id => id.trim())
    .filter(id => id.length > 0);

// Whether a required setting is present; the template list counts as set only
// when it names at least one template
const isSet = (config: DocuSignConfig, key: DocuSignConfigKey): boolean =>
  key === 'templateId' ? templateIds(config).length > 0 : Boolean(config[key]);

// The environment variable names of the required settings that are unset
export const missingDocuSignConfig = (
  config: DocuSignConfig,
  required: readonly DocuSignConfigKey[] = JWT_CREDENTIALS,
): string[] =>
  required.filter(key => !isSet(config, key)).map(key => DOCUSIGN_ENV[key]);

// A setting the requested operation cannot do without
export class DocuSignConfigError extends Error {
  constructor(public readonly missing: string[]) {
    // The key has three accepted sources, so naming only the first one
    // sends an operator who set _BASE64 or _FILE hunting the wrong variable
    const keySources = missing.includes(DOCUSIGN_ENV.privateKey)
      ? `. The private key comes from ${DOCUSIGN_PRIVATE_KEY_SOURCES.privateKey}, ${DOCUSIGN_PRIVATE_KEY_SOURCES.base64} or ${DOCUSIGN_PRIVATE_KEY_SOURCES.file}.`
      : '';
    super(
      `DocuSign: missing configuration: ${missing.join(', ')}${keySources}`,
    );
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

// The DocuSign developer (demo) environment, by host: demo.docusign.net and
// the `-d` OAuth/apps hosts. Every DOCUSIGN_DEMO_URLS default is one of
// these, so a config left on the defaults is detected as demo.
const DEMO_HOST = /^(demo\.docusign\.net|[a-z0-9-]+-d\.docusign\.com)$/i;

// True when `url` points at the DocuSign developer environment
export const isDocuSignDemoHost = (url: string | undefined): boolean => {
  if (!url) {
    return false;
  }
  try {
    return DEMO_HOST.test(new URL(url).hostname);
  } catch {
    return false;
  }
};

// The three host settings, the ones that decide demo vs production
const HOST_SETTINGS: readonly DocuSignConfigKey[] = [
  'apiBaseUrl',
  'oauthBaseUrl',
  'webFormsBaseUrl',
];

// The demo hosts a configuration still points at, as "VAR=value" - what a
// production boot check reports back to the operator
export const docuSignDemoHostsInUse = (config: DocuSignConfig): string[] =>
  HOST_SETTINGS.filter(key => isDocuSignDemoHost(config[key])).map(
    key => `${DOCUSIGN_ENV[key]}=${config[key]}`,
  );
