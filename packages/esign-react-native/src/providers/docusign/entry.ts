// The ./docusign entry's surface (src/docusign.ts re-exports this file), Apollo-free.
//
// For consumers that only use DocuSign Web Forms (API-embedded or public URL):
// the DocuSign provider plus the neutral signing layer, from core's /docusign
// entry. Nothing reachable from this file imports '@apollo/client' or
// 'graphql', so those peers never need to be installed. Enforced by the
// webform-entry guard test. ./webform is this entry's alias; proxy-mode
// consumers import the package root instead.
//
//   import { ESignature, createWebFormsSource } from '@blinkbitcoin/esign-react-native/docusign';

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
} from '@blinkbitcoin/esign-core/docusign';
export {
  createHostedFormMinter,
  createHostedFormPublicUrlSource,
  createHostedFormSource,
  createPublicUrlSource,
  createWebFormsMinter,
  createWebFormsSource,
  interpretBridgeEvent,
  interpretDocuSignEvent,
  interpretProxyEvent,
  isRestartable,
  resolveHostedFormCreateInstance,
} from '@blinkbitcoin/esign-core/docusign';
export { ESignature, getErrorMessage } from '../../ESignature';
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
} from '../../types';
export { useESignature } from '../../useESignature';
