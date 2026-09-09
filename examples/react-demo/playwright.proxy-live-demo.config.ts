import { defineConfig } from '@playwright/test';

import { liveViteDevServer, baseURL, retries } from './e2e/ports';

// The web demo (proxy mode) against REAL DocuSign: the demo creates an
// envelope through the live service at E2E_LIVE_API_ORIGIN (ESIGN_PROVIDER=
// docusign, already running - make e2e-live starts it), embeds the real
// signing ceremony in the component's iframe, and the spec signs there.
// Without E2E_LIVE_API_ORIGIN the suite skips itself.
const apiOrigin = process.env.E2E_LIVE_API_ORIGIN;

export default defineConfig({
  testDir: 'e2e',
  testMatch: '**/proxy-live-demo.spec.ts',
  timeout: 180_000,
  retries,
  use: {
    // DocuSign (a public site) redirects the iframe to the service's
    // return-URL bridge on localhost; Chrome's Local Network Access policy
    // blocks that navigation (ERR_BLOCKED_BY_LOCAL_NETWORK_ACCESS_CHECKS).
    // A deployed service has a public return URL; here, lift the check.
    launchOptions: { args: ['--disable-features=LocalNetworkAccessChecks'] },
    baseURL: baseURL('proxy'),
    viewport: { width: 1000, height: 1100 },
  },
  webServer: apiOrigin
    ? [liveViteDevServer(apiOrigin, undefined, 'proxy')]
    : [],
});
