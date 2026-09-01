// @blinkbitcoin/esignature-core/webform - the Apollo-free entry.
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

export type { RecipientData } from './types';

export { createWebFormsSource } from './signing/webFormsSource';
export type {
  WebFormsSigningSourceOptions,
  WebFormsInstance,
} from './signing/webFormsSource';

export { createPublicUrlSource } from './signing/publicUrlSource';
export type { PublicUrlSigningSourceOptions } from './signing/publicUrlSource';

export { interpretDocuSignEvent, interpretProxyEvent } from './signing/events';
export { getErrorMessage } from './signing/messages';
export { isRestartable } from './signing/types';
export type {
  SigningSource,
  RestartableSigningSource,
  SigningSession,
  SigningEvent,
  SigningSourceError,
} from './signing/types';
