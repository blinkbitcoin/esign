import { Platform } from 'react-native';

// ESIGN_MODE is inlined at bundle time by babel (see babel.config.js); declare
// the shape we read without pulling in full @types/node.
declare const process: { env: { ESIGN_MODE?: string } };

const BACKEND_PORT = 4000;

export const getDevBackendHost = (platformOs: string): string =>
  platformOs === 'android' ? '10.0.2.2' : 'localhost';

const backendOrigin = `http://${getDevBackendHost(Platform.OS)}:${BACKEND_PORT}`;

export const GRAPHQL_URL = `${backendOrigin}/graphql`;
export const WEBFORM_INSTANCE_URL = `${backendOrigin}/webform/instance`;

// Signing mode, toggled at bundle time by ESIGN_MODE ('proxy' | 'webform').
// proxy   → backend creates an envelope (GraphQL)
// webform → DocuSign Web Forms instance minted via POST /webform/instance
export type EsignMode = 'proxy' | 'webform';

// ESIGN_MODE is inlined at bundle time (babel.config.js), so the value below
// is a literal in the bundle; the resolver is exported to keep it testable.
export const resolveEsignMode = (value: string | undefined): EsignMode =>
  value === 'webform' ? 'webform' : 'proxy';

export const ESIGN_MODE: EsignMode = resolveEsignMode(process.env.ESIGN_MODE);
