// Public surface of the signing-source abstraction.

export type {
  SigningEvent,
  SigningSession,
  SigningSource,
  SigningSourceError,
  RestartableSigningSource,
} from './types';
export { isRestartable } from './types';

export { interpretProxyEvent, interpretDocuSignEvent } from './events';
export { getErrorMessage } from './messages';

export { createProxySigningSource, getApolloErrorCode } from './proxySource';
export type { ProxySigningSourceOptions } from './proxySource';

export { createWebFormsSource } from './webFormsSource';
export type {
  WebFormsSigningSourceOptions,
  WebFormsInstance,
} from './webFormsSource';

export { createPublicUrlSource } from './publicUrlSource';
export type { PublicUrlSigningSourceOptions } from './publicUrlSource';
