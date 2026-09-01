// Demo configuration - a real host app would take this from its own
// environment/config system.
export const API_ORIGIN = 'http://localhost:4000';
export const GRAPHQL_URL = `${API_ORIGIN}/graphql`;
export const WEBFORM_INSTANCE_URL = `${API_ORIGIN}/webform/instance`;
// A "published public form" URL (prefill via query params). For the demo it
// points at the mock web-form page; a real one is a DocuSign published-form URL.
export const PUBLIC_FORM_URL = `${API_ORIGIN}/signing/mock-webform/public-demo?full_name=Test+User`;

export type EsignMode = 'proxy' | 'webform' | 'publicurl';

// Signing mode, toggled by VITE_ESIGN_MODE.
// proxy     → backend creates an envelope (GraphQL)
// webform   → DocuSign Web Forms instance minted via POST /webform/instance
// publicurl → a static published Web Form URL (no backend, prefill in the URL)
const MODE = import.meta.env.VITE_ESIGN_MODE;
export const ESIGN_MODE: EsignMode =
  MODE === 'webform' || MODE === 'publicurl' ? MODE : 'proxy';
