import { defineConfig } from '@playwright/test';

import { backendServer, baseURL, retries, viteDevServer } from './e2e/ports';

// Browser E2E for the DocuSign Web Forms mode. Same real stack as the proxy
// E2E, but the demo runs in webform mode (VITE_ESIGN_MODE=webform) on its own
// port so it can't collide with the proxy Vite. The backend mock provider
// mints a mock-webform instance that emits the REAL DocuSign event
// vocabulary, so a green run proves the Web Forms wiring + protocol. Ports
// are per worktree (e2e/ports.ts).
//
// For a LIVE run against real DocuSign see playwright.webform-live.config.ts.
export default defineConfig({
  testDir: 'e2e',
  testMatch: '**/webform.spec.ts',
  timeout: 30_000,
  retries,
  use: {
    baseURL: baseURL('webform'),
  },
  webServer: [backendServer(), viteDevServer('webform')],
});
