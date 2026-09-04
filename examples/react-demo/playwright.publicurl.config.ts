import { defineConfig } from '@playwright/test';

// Browser E2E for the public-URL Web Forms mode (createPublicUrlSource): no
// backend minting call - the demo embeds a static published-form URL directly.
// For the deterministic run the URL points at the backend's mock-webform page
// (real DocuSign sessionEnd vocabulary); a live run uses a real published form.
// Runs on port 5175 so it can't collide with the proxy/webform demos. Like
// the other suites it builds the demo (dist/publicurl) and previews it.
export default defineConfig({
  testDir: 'e2e',
  testMatch: '**/publicurl.spec.ts',
  timeout: 30_000,
  retries: 0,
  use: {
    baseURL: 'http://localhost:5175',
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
        'VITE_ESIGN_MODE=publicurl npm run build -- --outDir dist/publicurl && npm run preview -- --outDir dist/publicurl --port 5175 --strictPort',
      url: 'http://localhost:5175',
      reuseExistingServer: false,
      timeout: 30_000,
    },
  ],
});
