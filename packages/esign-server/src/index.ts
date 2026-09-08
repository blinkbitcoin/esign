// @blinkbitcoin/esign-server - the server-side half of the e-signature
// packages: a DocuSign client (JWT grant, envelopes, Web Forms) and the one
// call a host needs for locked prefill, createWebFormInstance. Node only.

export { createWebFormInstance, clientFor } from './webforms';
export type { CreateWebFormInstanceParams } from './webforms';

// --- Domain: the envelope service over a provider port and a store port ----
export { createEnvelopeService } from './envelopes';
export type {
  EnvelopeService,
  EnvelopeServiceDeps,
  EnvelopeView,
  WebhookOutcome,
} from './envelopes';
export { supportsWebForms } from './provider';
export type { ESignProvider } from './provider';
export { createMemoryEnvelopeStore } from './store';
export type {
  EnvelopeStore,
  EnvelopeRecord,
  NewEnvelope,
  NewAuditEntry,
} from './store';
export { sanitizeAuditMetadata } from './audit';
export type { AuditAction, AuditEntry, AuditMetadata } from './audit';
export {
  ESignError,
  ErrorCodes,
  Errors,
  createError,
  getErrorCode,
} from './errors';
export type { ErrorCode } from './errors';
export {
  isValidEmail,
  requireId,
  validateContractType,
  validateRecipient,
  MAX_CONTRACT_TYPE_LENGTH,
  MAX_NAME_LENGTH,
} from './validation';
export { validateHmac } from './hmac';
export type { ValidateHmacOptions } from './hmac';
export { consoleLogger, sanitizeForLog } from './log';
export type { Logger } from './log';
export { noopTracing } from './tracing';
export type { Tracing, SpanLike, SpanAttributes } from './tracing';

// --- Wire layer pieces that need no framework --------------------------------
export {
  createWebFormInstanceHandler,
  createWebhookHandler,
  mintWebFormInstanceHttp,
  processWebhookHttp,
} from './handlers';
export type {
  HttpResult,
  MintHttpInput,
  MintTarget,
  WebFormInstanceHandlerOptions,
  WebhookHandlerOptions,
  WebhookHttpInput,
} from './handlers';
export { createESignGraphQL, typeDefs } from './graphql';
export type { ESignGraphQLOptions, GraphQLContext } from './graphql';
export {
  CLIENT_EVENTS,
  LOCKED_FIELDS_HINT,
  mapDocuSignReturnEvent,
  mockWebFormFields,
  renderMockSigningPage,
  renderMockWebFormPage,
  renderSigningReturnBridge,
} from './pages';
export type { ClientEvent, MockWebFormField } from './pages';
export { escapeHtml, jsonForScript, sanitizeId } from './html';

// --- Provider adapters -------------------------------------------------------
export {
  createDocuSignProvider,
  mapDocuSignStatus,
  mapWebhookStatus,
  parseDocuSignWebhook,
  DOCUSIGN_SIGNATURE_HEADER,
} from './providers/docusign';
export type {
  DocuSignProviderHandle,
  DocuSignProviderOptions,
  DocuSignWebhookOptions,
  DocuSignWebhookPayload,
} from './providers/docusign';
export { createMockProvider } from './providers/mock';
export type { MockProviderHandle, MockProviderOptions } from './providers/mock';

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
  EnvelopeStatus,
  EnvelopeResult,
  SigningUrlResult,
  WebhookHeaders,
  WebhookEvent,
  CreateEnvelopeInput,
  GetSigningUrlInput,
} from './types';
