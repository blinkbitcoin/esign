// @blinkbitcoin/esign-react-native/webform - the Apollo-free entry.
//
// For consumers that only use DocuSign Web Forms (API-embedded or public URL):
// nothing reachable from this file imports '@apollo/client' or 'graphql', so
// those peers never need to be installed. Enforced by the webform-entry guard
// test. Proxy-mode consumers import the package root instead.
//
//   import { ESignature, createWebFormsSource } from '@blinkbitcoin/esign-react-native/webform';

export type {
  HostedFormCreateInstanceOptions,
  HostedFormInstance,
  HostedFormMintOptions,
  HostedFormPrefill,
  HostedFormPublicUrlSourceOptions,
  HostedFormSourceOptions,
  MintHostedFormOptions,
  MintWebFormsInstanceOptions,
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
} from '@blinkbitcoin/esign-core/webform';
export {
  createHostedFormMinter,
  createHostedFormPublicUrlSource,
  createHostedFormSource,
  interpretBridgeEvent,
  resolveHostedFormCreateInstance,
  createPublicUrlSource,
  createWebFormsMinter,
  createWebFormsSource,
  interpretDocuSignEvent,
  interpretProxyEvent,
  isRestartable,
} from '@blinkbitcoin/esign-core/webform';
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
