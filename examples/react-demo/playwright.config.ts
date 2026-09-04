import { defineConfig } from '@playwright/test';

// Browser E2E for the web demo: drives the built demo (vite preview, :5173,
// over the libraries' dist - what a consumer installs) embedding
// the backend's real mock signing page (:4000) in a genuinely cross-origin
// iframe - exercising the window.postMessage path jsdom can only fake.
//
// Prerequisite (handled by `make e2e-web` at the repo root): the dockerized
// test database is up and migrated; both servers below are started here.
export default defineConfig({
  testDir: 'e2e',
  testIgnore: ['**/webform.spec.ts', '**/publicurl.spec.ts'],
  timeout: 30_000,
  retries: 0,
  use: {
    baseURL: 'http://localhost:5173',
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
        'npm run build -- --outDir dist/proxy && npm run preview -- --outDir dist/proxy --port 5173 --strictPort',
      url: 'http://localhost:5173',
      reuseExistingServer: true,
      timeout: 30_000,
    },
  ],
});
