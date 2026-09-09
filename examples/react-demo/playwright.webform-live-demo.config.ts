import { defineConfig } from '@playwright/test';

import { liveViteDevServer, baseURL, retries } from './e2e/ports';

// The web demo (webform mode) against a REAL DocuSign Web Form: the demo
// mints through the live service at E2E_LIVE_API_ORIGIN (ESIGN_PROVIDER=
// docusign, already running - make e2e-live starts it), embeds the real
// form in the component's iframe, and the spec drives it there. Without
// E2E_LIVE_API_ORIGIN the suite skips itself. See docs/integration/webforms.md.
const apiOrigin = process.env.E2E_LIVE_API_ORIGIN;

export default defineConfig({
  testDir: 'e2e',
  testMatch: '**/webform-live-demo.spec.ts',
  timeout: 120_000,
  retries,
  use: {
    baseURL: baseURL('webform'),
    viewport: { width: 600, height: 1100 },
  },
  webServer: apiOrigin
    ? [liveViteDevServer(apiOrigin, process.env.E2E_LIVE_PREFILL)]
    : [],
});
