// The DocuSign adapter, complete: client (JWT grant, envelopes, Web Forms),
// configuration, the provider over the port, the prefill contract, the
// return-URL bridge, the mock Web Forms page and the handlers' DocuSign mint
// target. Peer-free (Express pieces are on the ./express entry).

export type { TokenProvider } from './auth';
export { createJwtAssertion, createTokenProvider } from './auth';
export { mapDocuSignReturnEvent, renderSigningReturnBridge } from './bridge';
export type { DocuSignClient, DocuSignClientOptions } from './client';
export { createDocuSignClient } from './client';
export type {
  DocuSignConfig,
  DocuSignConfigFromEnvOptions,
  DocuSignConfigKey,
  Env,
  ReadFile,
} from './config';
export {
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
  templateIds,
} from './config';
export type { DocuSignMintTarget } from './handlers';
export { mintFromDocuSign } from './handlers';
export type { MockWebFormField } from './mockWebFormPage';
export {
  LOCKED_FIELDS_HINT,
  mockWebFormFields,
  POST_SESSION_END_SCRIPT,
  renderMockWebFormPage,
} from './mockWebFormPage';
export type {
  ParsedEnvelopePrefill,
  ParsedWebFormPrefill,
} from './prefill';
export {
  assertEnvelopePrefill,
  assertWebFormPrefill,
  formatPrefillValue,
  MAX_PREFILL_FIELDS,
  PrefillError,
  parseEnvelopePrefill,
  parseWebFormPrefill,
  WebFormPrefillError,
} from './prefill';
export type {
  DocuSignProviderHandle,
  DocuSignProviderOptions,
  DocuSignWebhookOptions,
  DocuSignWebhookPayload,
} from './provider';
export {
  createDocuSignProvider,
  DOCUSIGN_SIGNATURE_HEADER,
  mapDocuSignStatus,
  mapWebhookStatus,
  parseDocuSignWebhook,
} from './provider';
export type {
  EnvelopeTabPrefill,
  EnvelopeTabValue,
  WebFormPhoneNumber,
  WebFormPrefill,
  WebFormPrefillValue,
} from './types';
export type { CreateWebFormInstanceParams, WebFormsClient } from './webforms';
export { clientFor, createWebFormInstance } from './webforms';
