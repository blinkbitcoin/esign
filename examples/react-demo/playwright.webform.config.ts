import { defineConfig } from '@playwright/test';

// Browser E2E for the DocuSign Web Forms mode. Same real stack as the proxy
// E2E, but the demo runs in webform mode (VITE_ESIGN_MODE=webform) on a
// separate port (5174) so it can't collide with the proxy demo. The backend
// mock provider mints a mock-webform instance that emits the REAL DocuSign
// event vocabulary, so a green run proves the Web Forms wiring + protocol.
//
// For a LIVE run against real DocuSign: start the backend with
// ESIGN_PROVIDER=docusign + the DOCUSIGN_* / DOCUSIGN_WEBFORM_ID config, and
// this same spec drives the real form (credentialed, non-CI).
export default defineConfig({
  testDir: 'e2e',
  testMatch: '**/webform.spec.ts',
  timeout: 30_000,
  retries: 0,
  use: {
    baseURL: 'http://localhost:5174',
  },
  webServer: [
    {
      command:
        'ESIGN_PROVIDER=mock npx dotenv-cli -e apps/api/.env.test -- npm run dev -w apps/api',
      cwd: '../..',
      url: 'http://localhost:4000/health',
      reuseExistingServer: true,
      timeout: 30_000,
    },
    {
      // Production bundle over the libraries' built dist (see vite.config.ts).
      command:
        'VITE_ESIGN_MODE=webform npm run build -- --outDir dist/webform && npm run preview -- --outDir dist/webform --port 5174 --strictPort',
      url: 'http://localhost:5174',
      reuseExistingServer: false,
      timeout: 30_000,
    },
  ],
});
