import { defineConfig } from '@playwright/test';

import { backendServer, baseURL, viteDevServer } from './e2e/ports';

// Browser E2E for the public-URL Web Forms mode (createPublicUrlSource): no
// backend minting call - the demo embeds a static published-form URL directly.
// For the deterministic run the URL points at the backend's mock-webform page
// (real DocuSign sessionEnd vocabulary); a live run uses a real published form.
// Runs on its own port so it can't collide with the proxy/webform demos;
// ports are per worktree (e2e/ports.ts).
export default defineConfig({
  testDir: 'e2e',
  testMatch: '**/publicurl.spec.ts',
  timeout: 30_000,
  retries: 0,
  use: {
    baseURL: baseURL('publicurl'),
  },
  webServer: [backendServer(), viteDevServer('publicurl')],
});
