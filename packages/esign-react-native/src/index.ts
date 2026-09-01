// @blinkbitcoin/esign-react-native - public API
//
// Plug-and-play e-signature signing flow for React Native apps. The component
// is provider-agnostic: give it a SigningSource for the mode you want.
//
//   // Proxy (backend envelope via the GraphQL API):
//   const client = createESignApolloClient({ uri, getAuthToken });
//   const source = createProxySigningSource({ client, contractType, recipient });
//   <ESignature source={source} onComplete onError onCancel />
//
//   // DocuSign Web Forms (API-embedded) / public Web Form URL:
//   createWebFormsSource({ createInstance }) · createPublicUrlSource({ url })
//
// The signing abstraction, sources, Apollo factory, and operations come from
// @blinkbitcoin/esign-core and are re-exported here for convenience.

export { ESignature, getErrorMessage } from './ESignature';
export { getApolloErrorCode } from '@blinkbitcoin/esign-core';
export type {
  ESignatureProps,
  ESignatureStatus,
  ESignatureError,
  ESignatureResult,
  RecipientData,
} from './types';

// Re-export the platform-agnostic core surface
export {
  createProxySigningSource,
  createWebFormsSource,
  createPublicUrlSource,
  isRestartable,
  interpretProxyEvent,
  interpretDocuSignEvent,
  createESignApolloClient,
  createAuthContextSetter,
  handleApolloErrors,
  ErrorCodes,
  ErrorCode,
  CREATE_ENVELOPE_MUTATION,
  GET_SIGNING_URL_MUTATION,
} from '@blinkbitcoin/esign-core';
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
  ESignApolloClientOptions,
  GetAuthToken,
  CreateEnvelopeInput,
  CreateEnvelopeResult,
  GetSigningUrlInput,
  GetSigningUrlResult,
} from '@blinkbitcoin/esign-core';
