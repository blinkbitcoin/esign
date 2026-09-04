// @blinkbitcoin/esign-react - public API
//
// Plug-and-play e-signature signing flow for React web apps. Provider-agnostic:
// give the component a SigningSource for the mode you want.
//
//   // Proxy (backend envelope via the GraphQL API):
//   const client = createESignApolloClient({ uri, getAuthToken });
//   const source = createProxySigningSource({ client, contractType, recipient });
//   <ApolloProvider client={client}>
//     <ESignature source={source} onComplete onError onCancel />
//   </ApolloProvider>
//
//   // DocuSign Web Forms (host mints the instance URL) / public URL / real DocuSign.js:
//   createWebFormsSource · createPublicUrlSource · createDocuSignWebFormsSource
//
// The signing abstraction, sources, Apollo factory, and operations come from
// @blinkbitcoin/esign-core (shared with the RN package) and are re-exported.

export { ESignature, getErrorMessage, getApolloErrorCode } from './ESignature';
export { useESignature } from './useESignature';
export type {
  ESignatureProps,
  ESignatureStatus,
  ESignatureError,
  ESignatureResult,
  ESignatureTheme,
  ESignatureStyles,
  ESignatureStyleKey,
  ESignatureLabels,
  ESignatureEmbed,
  UseESignatureOptions,
  UseESignatureResult,
  RecipientData,
} from './types';

// Web-only: DocuSign.js-backed Web Forms source (real embedded Web Forms).
export { createDocuSignWebFormsSource, isMountable } from './docusignWebForms';
export type {
  DocuSignWebFormsSourceOptions,
  MountableSigningSource,
  DocuSignSdk,
  DocuSignSigning,
  LoadDocuSign,
} from './docusignWebForms';

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
