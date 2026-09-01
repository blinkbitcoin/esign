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
export const ESIGN_MODE: 'proxy' | 'webform' =
  process.env.ESIGN_MODE === 'webform' ? 'webform' : 'proxy';
