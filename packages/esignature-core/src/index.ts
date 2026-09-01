// @blinkbitcoin/esignature-core - platform-agnostic core shared by the RN and
// web signing packages: the SigningSource abstraction + built-in sources, the
// Apollo client factory + error-code contract, the GraphQL operations, and the
// generated types. No React/DOM/WebView - the platform packages layer the
// ESignature component on top.

export type { RecipientData } from './types';

// Signing sources + the abstraction they satisfy
export {
  createProxySigningSource,
  createWebFormsSource,
  createPublicUrlSource,
  isRestartable,
  interpretProxyEvent,
  interpretDocuSignEvent,
  getErrorMessage,
  getApolloErrorCode,
} from './signing';
export type {
  SigningSource,
  RestartableSigningSource,
  SigningSession,
  SigningEvent,
  SigningSourceError,
  ProxySigningSourceOptions,
  WebFormsSigningSourceOptions,
  WebFormsInstance,
  PublicUrlSigningSourceOptions,
} from './signing';

// Apollo client factory + error-code contract
export {
  createESignApolloClient,
  createAuthContextSetter,
  handleApolloErrors,
  ErrorCodes,
} from './client';
export type { ESignApolloClientOptions, GetAuthToken } from './client';

// Generated wire-contract enum
export { ErrorCode } from './generated/error-code';

// GraphQL operations
export {
  CREATE_ENVELOPE_MUTATION,
  GET_SIGNING_URL_MUTATION,
} from './operations';
export type {
  CreateEnvelopeInput,
  CreateEnvelopeResult,
  GetSigningUrlInput,
  GetSigningUrlResult,
} from './operations';
