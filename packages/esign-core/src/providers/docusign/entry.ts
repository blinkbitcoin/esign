// The ./docusign entry's surface (src/docusign.ts re-exports this file), Apollo-free.
//
// The DocuSign provider (providers/docusign: the Web Forms sources, the
// interpreter, the prefill contract) plus the neutral signing layer it is
// built on (the hosted-form layer, the bridge interpreter, the state
// machine, labels, errors). Nothing reachable from this file imports
// '@apollo/client' or 'graphql', so a DocuSign-only consumer never installs
// them (bundlers resolve imports statically - the proxy/Apollo modules are
// simply never reached). Enforced by the webform-entry guard tests.
// ./webform is this entry's alias.
//
// Ships both Web Forms shapes:
//   - createWebFormsSource: API-embedded (a backend mints the instance URL)
//   - createPublicUrlSource: a published public form URL (no backend)

export {
  interpretBridgeEvent,
  interpretProxyEvent,
} from '../../signing/bridge';
export {
  isSigningSourceError,
  SigningSourceError,
  toSigningSourceError,
} from '../../signing/errors';
export type {
  HostedFormInstance,
  HostedFormPrefill,
  MintHostedFormOptions,
} from '../../signing/hostedForm/mint';
export { createHostedFormMinter } from '../../signing/hostedForm/mint';
export type { HostedFormPublicUrlSourceOptions } from '../../signing/hostedForm/publicUrlSource';
export { createHostedFormPublicUrlSource } from '../../signing/hostedForm/publicUrlSource';
export type {
  HostedFormCreateInstanceOptions,
  HostedFormMintOptions,
  HostedFormSourceOptions,
} from '../../signing/hostedForm/source';
// The provider-neutral hosted-form layer the Web Forms sources are built on
export {
  createHostedFormSource,
  resolveHostedFormCreateInstance,
} from '../../signing/hostedForm/source';
export type { ESignatureLabels, LabelDefaults } from '../../signing/labels';
export { resolveLabelsWith } from '../../signing/labels';
export type {
  ESignatureError,
  ESignatureResult,
  ESignatureStatus,
  SigningAction,
  SigningCallbacks,
  SigningEffect,
  SigningMachineState,
  SigningStateSeed,
} from '../../signing/machine';
export {
  acquireSession,
  initialSigningState,
  resolveRestart,
  transition,
} from '../../signing/machine';
export { getErrorMessage } from '../../signing/messages';
export { isAllowedOrigin } from '../../signing/origin';
export type {
  MountableSigningSource,
  RestartableSigningSource,
  SigningEvent,
  SigningSession,
  SigningSource,
} from '../../signing/types';
export { isMountable, isRestartable } from '../../signing/types';
export { withTimeout } from '../../signing/withTimeout';
export type {
  ESignatureTheme,
  ESignLogger,
  RecipientData,
  UseESignatureOptions,
} from '../../types';
export type {
  MintWebFormsInstanceOptions,
  PublicUrlSigningSourceOptions,
  WebFormPhoneNumber,
  WebFormPrefill,
  WebFormPrefillValue,
  WebFormsCreateInstanceOptions,
  WebFormsInstance,
  WebFormsMintOptions,
  WebFormsSigningSourceOptions,
} from './index';
// The DocuSign provider: its sources, interpreter and prefill contract
export {
  createPublicUrlSource,
  createWebFormsMinter,
  createWebFormsSource,
  interpretDocuSignEvent,
  resolveCreateInstance,
} from './index';
