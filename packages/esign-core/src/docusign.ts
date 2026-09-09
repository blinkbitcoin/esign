// @blinkbitcoin/esign-core/docusign - the DocuSign entry, Apollo-free.
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

export type {
  RecipientData,
  ESignatureTheme,
  UseESignatureOptions,
} from './types';

// The provider-neutral hosted-form layer the Web Forms sources are built on
export {
  createHostedFormSource,
  resolveHostedFormCreateInstance,
} from './signing/hostedForm/source';
export type {
  HostedFormSourceOptions,
  HostedFormCreateInstanceOptions,
  HostedFormMintOptions,
} from './signing/hostedForm/source';
export { createHostedFormMinter } from './signing/hostedForm/mint';
export type {
  HostedFormPrefill,
  HostedFormInstance,
  MintHostedFormOptions,
} from './signing/hostedForm/mint';
export { createHostedFormPublicUrlSource } from './signing/hostedForm/publicUrlSource';
export type { HostedFormPublicUrlSourceOptions } from './signing/hostedForm/publicUrlSource';

// The DocuSign provider: its sources, interpreter and prefill contract
export {
  createPublicUrlSource,
  createWebFormsMinter,
  createWebFormsSource,
  interpretDocuSignEvent,
  resolveCreateInstance,
} from './providers/docusign';
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
} from './providers/docusign';

export { interpretBridgeEvent, interpretProxyEvent } from './signing/bridge';
export { getErrorMessage } from './signing/messages';
export { isRestartable, isMountable } from './signing/types';
export {
  SigningSourceError,
  isSigningSourceError,
  toSigningSourceError,
} from './signing/errors';
export { withTimeout } from './signing/withTimeout';
export { isAllowedOrigin } from './signing/origin';
export {
  acquireSession,
  initialSigningState,
  resolveRestart,
  transition,
} from './signing/machine';
export type {
  ESignatureError,
  ESignatureResult,
  ESignatureStatus,
  SigningAction,
  SigningCallbacks,
  SigningEffect,
  SigningMachineState,
  SigningStateSeed,
} from './signing/machine';
export { resolveLabelsWith } from './signing/labels';
export type { ESignatureLabels, LabelDefaults } from './signing/labels';
export type {
  SigningSource,
  RestartableSigningSource,
  MountableSigningSource,
  SigningSession,
  SigningEvent,
} from './signing/types';
