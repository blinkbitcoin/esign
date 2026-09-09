import { defineConfig } from '@playwright/test';

// Browser E2E against a REAL DocuSign Web Form (credentialed, opt-in, never
// CI). No web servers are started: the spec either opens a form instance URL
// given in E2E_LIVE_WEBFORM_URL, or mints one through an already-running
// backend (ESIGN_PROVIDER=docusign) at E2E_LIVE_API_ORIGIN. Without either
// variable the suite skips itself. See docs/integration/webforms.md.
export default defineConfig({
  testDir: 'e2e',
  testMatch: '**/webform-live.spec.ts',
  timeout: 90_000,
  retries: 0,
  use: {
    // A real Web Form renders as a mobile-ish single column; keep the
    // screenshot readable
    viewport: { width: 480, height: 1000 },
  },
});
