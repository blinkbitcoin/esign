// Public surface of the signing-source abstraction.

export type {
  SigningEvent,
  SigningSession,
  SigningSource,
  RestartableSigningSource,
  MountableSigningSource,
} from './types';
export { isRestartable, isMountable } from './types';

export {
  SigningSourceError,
  isSigningSourceError,
  toSigningSourceError,
} from './errors';
export { withTimeout } from './withTimeout';
export { isAllowedOrigin } from './origin';

export {
  acquireSession,
  initialSigningState,
  resolveRestart,
  transition,
} from './machine';
export type {
  ESignatureError,
  ESignatureResult,
  ESignatureStatus,
  SigningAction,
  SigningCallbacks,
  SigningEffect,
  SigningMachineState,
  SigningStateSeed,
} from './machine';
export { resolveLabelsWith } from './labels';
export type { ESignatureLabels, LabelDefaults } from './labels';

export { interpretBridgeEvent, interpretProxyEvent } from './bridge';
export { getErrorMessage } from './messages';

export { createProxySigningSource, getApolloErrorCode } from './proxySource';
export type { ProxySigningSourceOptions } from './proxySource';

// The provider-neutral hosted-form layer (a provider binds its interpreter +
// prefill contract on top - the Web Forms sources below are DocuSign's)
export {
  createHostedFormSource,
  resolveHostedFormCreateInstance,
} from './hostedForm/source';
export type {
  HostedFormSourceOptions,
  HostedFormCreateInstanceOptions,
  HostedFormMintOptions,
} from './hostedForm/source';
export { createHostedFormMinter } from './hostedForm/mint';
export type {
  HostedFormPrefill,
  HostedFormInstance,
  MintHostedFormOptions,
} from './hostedForm/mint';
export { createHostedFormPublicUrlSource } from './hostedForm/publicUrlSource';
export type { HostedFormPublicUrlSourceOptions } from './hostedForm/publicUrlSource';

// DocuSign's sources, interpreter and prefill contract live in
// providers/docusign; re-exported here for the old module path.
/** @deprecated Import from '@blinkbitcoin/esign-core' (providers/docusign) */
export {
  createPublicUrlSource,
  createWebFormsMinter,
  createWebFormsSource,
  interpretDocuSignEvent,
  resolveCreateInstance,
} from '../providers/docusign';
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
} from '../providers/docusign';
