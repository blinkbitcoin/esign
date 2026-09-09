// @blinkbitcoin/esign-server - the server-side half of the e-signature
// packages: a DocuSign client (JWT grant, envelopes, Web Forms) and the one
// call a host needs for locked prefill, createWebFormInstance. Node only.

export { createWebFormInstance, clientFor } from './docusign/webforms';
export type {
  CreateWebFormInstanceParams,
  WebFormsClient,
} from './docusign/webforms';

// --- Domain: the envelope service over a provider port and a store port ----
export { createEnvelopeService } from './envelopes';
export type {
  EnvelopeService,
  EnvelopeServiceDeps,
  EnvelopeView,
  WebhookOutcome,
} from './envelopes';
export {
  hostedFormMint,
  supportsHostedForms,
  supportsWebForms,
} from './provider';
export type {
  ESignProvider,
  HostedFormMint,
  HostedFormProvider,
} from './provider';
export {
  defaultRegistry,
  providerFromEnv,
  ESIGN_PROVIDER_ENV,
} from './registry';
export type {
  DefaultRegistryOptions,
  ProviderFromEnvOptions,
  ProviderRegistry,
} from './registry';
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
export { bearerToken } from './auth';
export { validateHmac } from './hmac';
export type { ValidateHmacOptions } from './hmac';
export { consoleLogger, sanitizeForLog } from './log';
export type { Logger } from './log';
export { noopTracing } from './tracing';
export type { Tracing, SpanLike, SpanAttributes } from './tracing';

// --- Wire layer pieces that need no framework --------------------------------
export {
  createHostedFormInstanceHandler,
  createWebFormInstanceHandler,
  createWebhookHandler,
  mintWebFormInstanceHttp,
  processWebhookHttp,
} from './handlers';
export type {
  HostedFormHandlerOptions,
  HostedFormInstanceHandlerOptions,
  HttpResult,
  MintFn,
  MintHttpInput,
  MintTarget,
  ParsedPrefill,
  PrefillParser,
  WebFormInstanceHandlerOptions,
  WebhookHandlerOptions,
  WebhookHttpInput,
} from './handlers';
export { mintFromDocuSign } from './docusign/handlers';
export type { DocuSignMintTarget } from './docusign/handlers';
export { createESignGraphQL, typeDefs } from './graphql';
export type { ESignGraphQLOptions, GraphQLContext } from './graphql';
export { renderMockFormPage, renderMockSigningPage } from './pages';
export type { MockFormButton, MockFormField, MockFormPage } from './pages';
export { CLIENT_EVENTS, POST_SIGNING_EVENT_SCRIPT } from './bridge/script';
export type { ClientEvent } from './bridge/script';
// DocuSign's pages, also on the ./docusign entry
export {
  mapDocuSignReturnEvent,
  renderSigningReturnBridge,
} from './docusign/bridge';
export {
  LOCKED_FIELDS_HINT,
  POST_SESSION_END_SCRIPT,
  mockWebFormFields,
  renderMockWebFormPage,
} from './docusign/mockWebFormPage';
export type { MockWebFormField } from './docusign/mockWebFormPage';
export { escapeHtml, jsonForScript, sanitizeId } from './html';
export {
  signingPageCsp,
  signingPageNonce,
  signingPageResponse,
} from './signingPage';

// --- Provider adapters -------------------------------------------------------
export {
  createDocuSignProvider,
  mapDocuSignStatus,
  mapWebhookStatus,
  parseDocuSignWebhook,
  DOCUSIGN_SIGNATURE_HEADER,
} from './docusign/provider';
export type {
  DocuSignProviderHandle,
  DocuSignProviderOptions,
  DocuSignWebhookOptions,
  DocuSignWebhookPayload,
} from './docusign/provider';
export { createMockProvider } from './mock/provider';
export type { MockProviderHandle, MockProviderOptions } from './mock/provider';

export { createDocuSignClient } from './docusign/client';
export type { DocuSignClient, DocuSignClientOptions } from './docusign/client';

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
} from './docusign/config';
export type { DocuSignConfig, DocuSignConfigKey, Env } from './docusign/config';

export { createTokenProvider, createJwtAssertion } from './docusign/auth';
export type { TokenProvider } from './docusign/auth';

export {
  parseWebFormPrefill,
  assertWebFormPrefill,
  formatPrefillValue,
  WebFormPrefillError,
  MAX_PREFILL_FIELDS,
} from './docusign/prefill';
export type { ParsedWebFormPrefill } from './docusign/prefill';

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
  HostedFormPrefill,
  HostedFormInstanceOptions,
  HostedFormInstanceResult,
  FetchLike,
  EnvelopeStatus,
  EnvelopeResult,
  SigningUrlResult,
  WebhookHeaders,
  WebhookEvent,
  CreateEnvelopeInput,
  GetSigningUrlInput,
} from './types';
