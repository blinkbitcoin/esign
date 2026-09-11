// @blinkbitcoin/esign-node - the server-side half of the e-signature
// packages: a DocuSign client (JWT grant, envelopes, Web Forms) and the one
// call a host needs for locked prefill, createWebFormInstance. Node only.

export type { AuditAction, AuditEntry, AuditMetadata } from './audit';
export { sanitizeAuditMetadata } from './audit';
export { bearerToken } from './auth';
export type { ClientEvent } from './bridge/script';
export { CLIENT_EVENTS, POST_SIGNING_EVENT_SCRIPT } from './bridge/script';
export type {
  EnvelopeService,
  EnvelopeServiceDeps,
  EnvelopeView,
  WebhookOutcome,
} from './envelopes';
// --- Domain: the envelope service over a provider port and a store port ----
export { createEnvelopeService } from './envelopes';
export type { ErrorCode } from './errors';
export {
  createError,
  ErrorCodes,
  Errors,
  ESignError,
  getErrorCode,
} from './errors';
export type { ESignGraphQLOptions, GraphQLContext } from './graphql';
export { createESignGraphQL, typeDefs } from './graphql';
export type {
  HostedFormApp,
  HostedFormAppCors,
  HostedFormAppOptions,
  HostedFormAppPrefillInput,
  HostedFormHandlerOptions,
  HostedFormInstanceHandlerOptions,
  HostedFormPrefillHook,
  HostedFormPrefillInput,
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
// --- Wire layer pieces that need no framework --------------------------------
export {
  createHostedFormApp,
  createHostedFormInstanceHandler,
  createWebFormInstanceHandler,
  createWebhookHandler,
  mintWebFormInstanceHttp,
  processWebhookHttp,
} from './handlers';
export type { ValidateHmacOptions } from './hmac';
export { validateHmac } from './hmac';
export { escapeHtml, jsonForScript, sanitizeId } from './html';
export type { RetryConfig } from './http';
export {
  HttpError,
  isClientError,
  isNotFoundError,
  RETRY_CONFIG,
  shouldRetry,
  sleep,
  withRetry,
} from './http';
export type { Logger } from './log';
export { consoleLogger, sanitizeForLog } from './log';
export type { MockFormButton, MockFormField, MockFormPage } from './pages';
export { renderMockFormPage, renderMockSigningPage } from './pages';
// --- Production boot guard ---------------------------------------------------
export type { ProductionConfig } from './production';
export {
  assertProductionConfig,
  ESIGN_ALLOW_DEMO,
  ESIGN_ENV,
  ProductionConfigError,
  productionErrors,
} from './production';
export type {
  ESignProvider,
  HostedFormMint,
  HostedFormProvider,
} from './provider';
export {
  hostedFormMint,
  supportsHostedForms,
  supportsWebForms,
} from './provider';
export type { TokenProvider } from './providers/docusign/auth';
export {
  createJwtAssertion,
  createTokenProvider,
} from './providers/docusign/auth';
// DocuSign's pages, also on the ./docusign entry
export {
  mapDocuSignReturnEvent,
  renderSigningReturnBridge,
} from './providers/docusign/bridge';
export type {
  DocuSignClient,
  DocuSignClientOptions,
} from './providers/docusign/client';
export { createDocuSignClient } from './providers/docusign/client';
export type {
  DocuSignConfig,
  DocuSignConfigFromEnvOptions,
  DocuSignConfigKey,
  Env,
  ReadFile,
} from './providers/docusign/config';
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
} from './providers/docusign/config';
export type { DocuSignMintTarget } from './providers/docusign/handlers';
export { mintFromDocuSign } from './providers/docusign/handlers';
export type { MockWebFormField } from './providers/docusign/mockWebFormPage';
export {
  LOCKED_FIELDS_HINT,
  mockWebFormFields,
  POST_SESSION_END_SCRIPT,
  renderMockWebFormPage,
} from './providers/docusign/mockWebFormPage';
export type {
  ParsedEnvelopePrefill,
  ParsedWebFormPrefill,
} from './providers/docusign/prefill';
export {
  assertEnvelopePrefill,
  assertWebFormPrefill,
  formatPrefillValue,
  MAX_PREFILL_FIELDS,
  PrefillError,
  parseEnvelopePrefill,
  parseWebFormPrefill,
  WebFormPrefillError,
} from './providers/docusign/prefill';
export type {
  DocuSignProviderHandle,
  DocuSignProviderOptions,
  DocuSignWebhookOptions,
  DocuSignWebhookPayload,
} from './providers/docusign/provider';
// --- Provider adapters -------------------------------------------------------
export {
  createDocuSignProvider,
  DOCUSIGN_SIGNATURE_HEADER,
  mapDocuSignStatus,
  mapWebhookStatus,
  parseDocuSignWebhook,
} from './providers/docusign/provider';
export type {
  CreateWebFormInstanceParams,
  WebFormsClient,
} from './providers/docusign/webforms';
export {
  clientFor,
  createWebFormInstance,
} from './providers/docusign/webforms';
export type {
  MockProviderHandle,
  MockProviderOptions,
} from './providers/mock/provider';
export { createMockProvider } from './providers/mock/provider';
export type {
  DefaultRegistryOptions,
  HostedFormProviderOptions,
  ProviderFromEnvOptions,
  ProviderRegistry,
} from './registry';
export {
  defaultRegistry,
  ESIGN_PROVIDER_ENV,
  hostedFormProviderFromEnv,
  providerFromEnv,
} from './registry';
export {
  signingPageCsp,
  signingPageNonce,
  signingPageResponse,
} from './signingPage';
export type {
  EnvelopeRecord,
  EnvelopeStore,
  NewAuditEntry,
  NewEnvelope,
} from './store';
export { createMemoryEnvelopeStore } from './store';
export type { SpanAttributes, SpanLike, Tracing } from './tracing';
export { noopTracing } from './tracing';
export type {
  CreateEnvelopeInput,
  EnvelopePrefill,
  EnvelopeResult,
  EnvelopeStatus,
  EnvelopeTabPrefill,
  EnvelopeTabValue,
  FetchLike,
  GetSigningUrlInput,
  HostedFormInstanceOptions,
  HostedFormInstanceResult,
  HostedFormPrefill,
  RecipientData,
  SigningUrlResult,
  WebFormInstanceOptions,
  WebFormInstanceResult,
  WebFormPhoneNumber,
  WebFormPrefill,
  WebFormPrefillValue,
  WebhookEvent,
  WebhookHeaders,
} from './types';
export {
  isValidEmail,
  MAX_CONTRACT_TYPE_LENGTH,
  MAX_NAME_LENGTH,
  requireId,
  validateContractType,
  validateRecipient,
} from './validation';
