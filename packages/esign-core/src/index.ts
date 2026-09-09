// @blinkbitcoin/esign-core - platform-agnostic core shared by the RN and
// web signing packages: the SigningSource abstraction + built-in sources, the
// Apollo client factory + error-code contract, the GraphQL operations, and the
// generated types. No React/DOM/WebView - the platform packages layer the
// ESignature component on top.

export type {
  RecipientData,
  ESignatureTheme,
  UseESignatureOptions,
} from './types';

// Signing sources + the abstraction they satisfy
export {
  createProxySigningSource,
  createHostedFormSource,
  createHostedFormMinter,
  createHostedFormPublicUrlSource,
  resolveHostedFormCreateInstance,
  createWebFormsSource,
  createWebFormsMinter,
  resolveCreateInstance,
  createPublicUrlSource,
  isRestartable,
  isMountable,
  SigningSourceError,
  isSigningSourceError,
  toSigningSourceError,
  withTimeout,
  isAllowedOrigin,
  interpretBridgeEvent,
  interpretProxyEvent,
  interpretDocuSignEvent,
  getErrorMessage,
  getApolloErrorCode,
  acquireSession,
  initialSigningState,
  resolveRestart,
  transition,
  resolveLabelsWith,
} from './signing';
export type {
  ESignatureError,
  ESignatureResult,
  ESignatureStatus,
  ESignatureLabels,
  LabelDefaults,
  SigningAction,
  SigningCallbacks,
  SigningEffect,
  SigningMachineState,
  SigningStateSeed,
  SigningSource,
  RestartableSigningSource,
  MountableSigningSource,
  SigningSession,
  SigningEvent,
  ProxySigningSourceOptions,
  HostedFormSourceOptions,
  HostedFormCreateInstanceOptions,
  HostedFormMintOptions,
  HostedFormPrefill,
  HostedFormInstance,
  MintHostedFormOptions,
  HostedFormPublicUrlSourceOptions,
  WebFormsSigningSourceOptions,
  WebFormsCreateInstanceOptions,
  WebFormsMintOptions,
  WebFormsInstance,
  MintWebFormsInstanceOptions,
  WebFormPrefill,
  WebFormPrefillValue,
  WebFormPhoneNumber,
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
