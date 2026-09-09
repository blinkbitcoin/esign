import type { WebFormPrefill } from '@blinkbitcoin/esign-react';

// Demo configuration - a real host app would take this from its own
// environment/config system.
// The backend origin; the E2E configs move it per worktree (e2e/ports.ts)
export const API_ORIGIN: string =
  import.meta.env.VITE_API_ORIGIN || 'http://localhost:4000';
export const GRAPHQL_URL = `${API_ORIGIN}/graphql`;
export const WEBFORM_INSTANCE_URL = `${API_ORIGIN}/webform/instance`;
// A "published public form" URL (prefill via query params). For the demo it
// points at the mock web-form page; a real one is a DocuSign published-form URL.
export const PUBLIC_FORM_URL = `${API_ORIGIN}/signing/mock-webform/public-demo?full_name=Test+User`;

// Prefill minted with a Web Forms instance (webform mode): the form's field
// API reference names → values, as JSON in VITE_ESIGN_PREFILL (the live E2E
// hands in the capability test form's fields); undefined = the built-in
// demo terms for the mock form (src/App.tsx).
export const PREFILL_OVERRIDE: WebFormPrefill | undefined = (() => {
  const raw = import.meta.env.VITE_ESIGN_PREFILL;
  if (!raw) {
    return undefined;
  }
  const parsed: unknown = JSON.parse(raw);
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('VITE_ESIGN_PREFILL must be a JSON object');
  }
  return parsed as WebFormPrefill;
})();

export type EsignMode = 'proxy' | 'webform' | 'publicurl';

// Signing mode, toggled by VITE_ESIGN_MODE.
// proxy     → backend creates an envelope (GraphQL)
// webform   → DocuSign Web Forms instance minted via POST /webform/instance
// publicurl → a static published Web Form URL (no backend, prefill in the URL)
const MODE = import.meta.env.VITE_ESIGN_MODE;
export const ESIGN_MODE: EsignMode =
  MODE === 'webform' || MODE === 'publicurl' ? MODE : 'proxy';
