// @blinkbitcoin/esign-react/docusign - the DocuSign entry.
//
// The DocuSign provider for the web: core's DocuSign sources, interpreter
// and prefill contract (from @blinkbitcoin/esign-core/docusign) plus the
// web-only DocuSign.js source, with the neutral signing layer, the component,
// the hook and the types. The component modules import the core root, so
// unlike the RN package this entry is not Apollo-free - it is the
// provider-scoped surface; proxy-mode consumers import the package root.
//
//   import { ESignature, createWebFormsSource, createDocuSignWebFormsSource } from '@blinkbitcoin/esign-react/docusign';

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
