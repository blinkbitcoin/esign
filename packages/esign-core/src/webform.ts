// @blinkbitcoin/esign-core/webform - the Apollo-free entry.
//
// Everything reachable from this file is guaranteed to never import
// '@apollo/client' or 'graphql', so a DocuSign Web Forms-only consumer can
// use it without installing any GraphQL dependencies (Metro and bundlers
// resolve imports statically - the proxy/Apollo modules are simply never
// reached). Enforced by tests/webform-entry guard tests.
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
