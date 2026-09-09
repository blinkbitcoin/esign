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
//   (Apollo-free from the ./docusign subpath; ./webform is its alias)
//
// The signing abstraction, sources, Apollo factory, and operations come from
// @blinkbitcoin/esign-core and are re-exported here for convenience.

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
  interpretBridgeEvent,
  resolveHostedFormCreateInstance,
  createProxySigningSource,
  createPublicUrlSource,
  createWebFormsMinter,
  createWebFormsSource,
  ErrorCode,
  ErrorCodes,
  GET_SIGNING_URL_MUTATION,
  getApolloErrorCode,
  handleApolloErrors,
  interpretDocuSignEvent,
  interpretProxyEvent,
  isRestartable,
} from '@blinkbitcoin/esign-core';
export { ESignature, getErrorMessage } from './ESignature';
export type {
  ESignatureError,
  ESignatureLabels,
  ESignatureProps,
  ESignatureResult,
  ESignatureStatus,
  ESignatureStyleKey,
  ESignatureStyles,
  ESignatureTheme,
  ESignatureWebViewProps,
  RecipientData,
  UseESignatureOptions,
  UseESignatureResult,
} from './types';
export { useESignature } from './useESignature';
