// @blinkbitcoin/esign-react-native/webform - the Apollo-free entry.
//
// For consumers that only use DocuSign Web Forms (API-embedded or public URL):
// nothing reachable from this file imports '@apollo/client' or 'graphql', so
// those peers never need to be installed. Enforced by the webform-entry guard
// test. Proxy-mode consumers import the package root instead.
//
//   import { ESignature, createWebFormsSource } from '@blinkbitcoin/esign-react-native/webform';

export { ESignature, getErrorMessage } from './ESignature';
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
  ESignatureWebViewProps,
  UseESignatureOptions,
  UseESignatureResult,
  RecipientData,
} from './types';

export {
  createWebFormsSource,
  createPublicUrlSource,
  interpretDocuSignEvent,
  interpretProxyEvent,
  isRestartable,
} from '@blinkbitcoin/esign-core/webform';
export type {
  SigningSource,
  RestartableSigningSource,
  SigningSession,
  SigningEvent,
  SigningSourceError,
  WebFormsSigningSourceOptions,
  WebFormsInstance,
  PublicUrlSigningSourceOptions,
} from '@blinkbitcoin/esign-core/webform';
