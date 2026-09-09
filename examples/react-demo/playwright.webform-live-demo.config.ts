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
    // DocuSign (a public site) redirects the iframe to the service's
    // return-URL bridge on localhost; Chrome's Local Network Access policy
    // blocks that navigation (ERR_BLOCKED_BY_LOCAL_NETWORK_ACCESS_CHECKS).
    // A deployed service has a public return URL; here, lift the check.
    launchOptions: {
      args: ['--disable-features=LocalNetworkAccessChecks'],
      // Recording mode paces every action so a viewer can read each page
      slowMo: process.env.E2E_LIVE_VIDEO ? 600 : 0,
    },
    baseURL: baseURL('webform'),
    viewport: { width: 600, height: 1100 },
    // E2E_LIVE_VIDEO=1 records each test (test-results/<test>/video.webm) -
    // the proof of the journey to share; off by default (make e2e-live)
    video: process.env.E2E_LIVE_VIDEO ? 'on' : 'off',
  },
  webServer: apiOrigin
    ? [liveViteDevServer(apiOrigin, process.env.E2E_LIVE_PREFILL)]
    : [],
});
