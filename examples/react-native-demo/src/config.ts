import { Platform } from 'react-native';

// ESIGN_MODE, ESIGN_PORT_BASE, ESIGN_BACKEND_PORT and ESIGN_PREFILL are inlined at bundle time
// by babel (see babel.config.js); declare the shape we read without pulling
// in full @types/node.
declare const process: {
  env: {
    ESIGN_MODE?: string;
    ESIGN_PORT_BASE?: string;
    ESIGN_BACKEND_PORT?: string;
    ESIGN_PREFILL?: string;
  };
};

// The backend port: ESIGN_BACKEND_PORT (the live run puts the service on
// another port: scripts/e2e/ios-live.sh), else the repo's ESIGN_PORT_BASE +
// the backend's offset (table: scripts/lib/ports.mjs), else 4100
export const PORT_BASE_DEFAULT = 4100;
const API_OFFSET = 0;
const digits = (value: string | undefined): number | undefined =>
  /^\d+$/.test(value ?? '') ? Number(value) : undefined;
export const resolveBackendPort = (
  override: string | undefined,
  base?: string,
): number =>
  digits(override) ?? (digits(base) ?? PORT_BASE_DEFAULT) + API_OFFSET;

const BACKEND_PORT = resolveBackendPort(
  process.env.ESIGN_BACKEND_PORT,
  process.env.ESIGN_PORT_BASE,
);

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

// Webform mode: the prefill minted with the instance. ESIGN_PREFILL (a JSON
// object, inlined at bundle time) replaces the demo's mock-form values so
// the same bundle can mint against a real form (scripts/e2e/ios-live.sh).
export type WebFormPrefill = Record<string, string | number>;

export const resolvePrefillOverride = (
  value: string | undefined,
): WebFormPrefill | undefined => {
  if (!value) {
    return undefined;
  }
  const parsed: unknown = JSON.parse(value);
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('ESIGN_PREFILL must be a JSON object');
  }
  return parsed as WebFormPrefill;
};

export const PREFILL_OVERRIDE = resolvePrefillOverride(
  process.env.ESIGN_PREFILL,
);
