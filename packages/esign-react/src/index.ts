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

export type {
  CreateEnvelopeInput,
  CreateEnvelopeResult,
  ESignApolloClientOptions,
  GetAuthToken,
  GetSigningUrlInput,
  GetSigningUrlResult,
  HostedFormCreateInstanceOptions,
  HostedFormInstance,
  HostedFormMintOptions,
  HostedFormPrefill,
  HostedFormPublicUrlSourceOptions,
  HostedFormSourceOptions,
  MintHostedFormOptions,
  MintWebFormsInstanceOptions,
  ProxySigningSourceOptions,
  PublicUrlSigningSourceOptions,
  RestartableSigningSource,
  SigningEvent,
  SigningSession,
  SigningSource,
  SigningSourceError,
  WebFormPhoneNumber,
  WebFormPrefill,
  WebFormPrefillValue,
  WebFormsCreateInstanceOptions,
  WebFormsInstance,
  WebFormsMintOptions,
  WebFormsSigningSourceOptions,
} from '@blinkbitcoin/esign-core';
// Re-export the platform-agnostic core surface
export {
  CREATE_ENVELOPE_MUTATION,
  createAuthContextSetter,
  createESignApolloClient,
  createHostedFormMinter,
  createHostedFormPublicUrlSource,
  createHostedFormSource,
  createProxySigningSource,
  createPublicUrlSource,
  createWebFormsMinter,
  createWebFormsSource,
  ErrorCode,
  ErrorCodes,
  GET_SIGNING_URL_MUTATION,
  getApolloErrorCode,
  handleApolloErrors,
  interpretBridgeEvent,
  interpretDocuSignEvent,
  interpretProxyEvent,
  isRestartable,
  resolveHostedFormCreateInstance,
} from '@blinkbitcoin/esign-core';
export { ESignature, getErrorMessage } from './ESignature';
export type {
  DocuSignSdk,
  DocuSignSigning,
  DocuSignWebFormsCreateInstanceOptions,
  DocuSignWebFormsMintOptions,
  DocuSignWebFormsSourceOptions,
  LoadDocuSign,
  MountableSigningSource,
} from './providers/docusign';
// Web-only: DocuSign.js-backed Web Forms source (real embedded Web Forms).
// Also on the ./docusign subpath, with the rest of the DocuSign provider.
export {
  createDocuSignWebFormsSource,
  isMountable,
} from './providers/docusign';
export type {
  ESignatureEmbed,
  ESignatureError,
  ESignatureLabels,
  ESignatureProps,
  ESignatureResult,
  ESignatureStatus,
  ESignatureStyleKey,
  ESignatureStyles,
  ESignatureTheme,
  RecipientData,
  UseESignatureOptions,
  UseESignatureResult,
} from './types';
export { useESignature } from './useESignature';
