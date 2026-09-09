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

export { interpretProxyEvent, interpretDocuSignEvent } from './events';
export { getErrorMessage } from './messages';

export { createProxySigningSource, getApolloErrorCode } from './proxySource';
export type { ProxySigningSourceOptions } from './proxySource';

export { createWebFormsSource, resolveCreateInstance } from './webFormsSource';
export type {
  WebFormsSigningSourceOptions,
  WebFormsCreateInstanceOptions,
  WebFormsMintOptions,
  WebFormsInstance,
} from './webFormsSource';

export { createWebFormsMinter } from './mint';
export type {
  MintWebFormsInstanceOptions,
  WebFormPrefill,
  WebFormPrefillValue,
  WebFormPhoneNumber,
} from './mint';

export { createPublicUrlSource } from './publicUrlSource';
export type { PublicUrlSigningSourceOptions } from './publicUrlSource';
