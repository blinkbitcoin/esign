// @blinkbitcoin/esign-server - the server-side half of the e-signature
// packages: a DocuSign client (JWT grant, envelopes, Web Forms) and the one
// call a host needs for locked prefill, createWebFormInstance. Node only.

export { createWebFormInstance, clientFor } from './webforms';
export type { CreateWebFormInstanceParams } from './webforms';

export { createDocuSignClient } from './client';
export type { DocuSignClient, DocuSignClientOptions } from './client';

export {
  docuSignConfigFromEnv,
  missingDocuSignConfig,
  assertDocuSignConfig,
  DocuSignConfigError,
  DOCUSIGN_ENV,
  DOCUSIGN_DEMO_URLS,
  JWT_CREDENTIALS,
} from './config';
export type { DocuSignConfig, DocuSignConfigKey, Env } from './config';

export { createTokenProvider, createJwtAssertion } from './auth';
export type { TokenProvider } from './auth';

export {
  parseWebFormPrefill,
  assertWebFormPrefill,
  formatPrefillValue,
  WebFormPrefillError,
  MAX_PREFILL_FIELDS,
} from './prefill';
export type { ParsedWebFormPrefill } from './prefill';

export {
  HttpError,
  RETRY_CONFIG,
  isClientError,
  isNotFoundError,
  shouldRetry,
  sleep,
  withRetry,
} from './http';
export type { RetryConfig } from './http';

export type {
  RecipientData,
  WebFormPrefill,
  WebFormPrefillValue,
  WebFormPhoneNumber,
  WebFormInstanceOptions,
  WebFormInstanceResult,
  FetchLike,
} from './types';
