// The DocuSign adapter, complete: client (JWT grant, envelopes, Web Forms),
// configuration, the provider over the port, the prefill contract, the
// return-URL bridge, the mock Web Forms page and the handlers' DocuSign mint
// target. Peer-free (Express pieces are on the ./express entry).

export { createDocuSignClient } from './client';
export type { DocuSignClient, DocuSignClientOptions } from './client';

export { createTokenProvider, createJwtAssertion } from './auth';
export type { TokenProvider } from './auth';

export {
  docuSignConfigFromEnv,
  missingDocuSignConfig,
  assertDocuSignConfig,
  DocuSignConfigError,
  DOCUSIGN_ENV,
  DOCUSIGN_DEMO_URLS,
  DOCUSIGN_SCOPES,
  JWT_CREDENTIALS,
  consentUrl,
} from './config';
export type { DocuSignConfig, DocuSignConfigKey, Env } from './config';

export {
  createDocuSignProvider,
  mapDocuSignStatus,
  mapWebhookStatus,
  parseDocuSignWebhook,
  DOCUSIGN_SIGNATURE_HEADER,
} from './provider';
export type {
  DocuSignProviderHandle,
  DocuSignProviderOptions,
  DocuSignWebhookOptions,
  DocuSignWebhookPayload,
} from './provider';

export { createWebFormInstance, clientFor } from './webforms';
export type { CreateWebFormInstanceParams, WebFormsClient } from './webforms';

export {
  parseWebFormPrefill,
  assertWebFormPrefill,
  formatPrefillValue,
  WebFormPrefillError,
  MAX_PREFILL_FIELDS,
} from './prefill';
export type { ParsedWebFormPrefill } from './prefill';

export { mapDocuSignReturnEvent, renderSigningReturnBridge } from './bridge';

export {
  LOCKED_FIELDS_HINT,
  POST_SESSION_END_SCRIPT,
  mockWebFormFields,
  renderMockWebFormPage,
} from './mockWebFormPage';
export type { MockWebFormField } from './mockWebFormPage';

export { mintFromDocuSign } from './handlers';
export type { DocuSignMintTarget } from './handlers';

export type {
  WebFormPhoneNumber,
  WebFormPrefill,
  WebFormPrefillValue,
} from './types';
