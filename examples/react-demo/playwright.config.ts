import { defineConfig } from '@playwright/test';

import {
  backendServer,
  baseURL,
  retries,
  vitePreviewServer,
} from './e2e/ports';

// Browser E2E for the proxy (envelope) mode: the demo is built and previewed
// against the packages' dist, and drives the backend's real mock signing page
// in a genuinely cross-origin iframe. Ports are per worktree (e2e/ports.ts).
export default defineConfig({
  testDir: 'e2e',
  testMatch: '**/signing.spec.ts',
  timeout: 30_000,
  retries,
  use: {
    baseURL: baseURL('proxy'),
  },
  webServer: [backendServer(), vitePreviewServer('proxy')],
});
