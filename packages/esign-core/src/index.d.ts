export type { RecipientData } from './types';
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
export {
  createESignApolloClient,
  createAuthContextSetter,
  handleApolloErrors,
  ErrorCodes,
} from './client';
export type { ESignApolloClientOptions, GetAuthToken } from './client';
export { ErrorCode } from './generated/error-code';
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
//# sourceMappingURL=index.d.ts.map
