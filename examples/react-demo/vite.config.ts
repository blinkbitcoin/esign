import path from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';
import { requireBuiltLibraries, sourceAliases } from './vite/libraries.ts';

const packages = path.resolve(import.meta.dirname, '../../packages');

// The demo's port: ESIGN_WEB_PORT, else the repo's ESIGN_PORT_BASE + 1
// (table: scripts/lib/ports.mjs) - never Vite's 5173, so worktrees and
// repos never clash; strict so a taken port fails instead of drifting
const portBase = Number(process.env.ESIGN_PORT_BASE || 4100);

const webPort = Number(process.env.ESIGN_WEB_PORT) || portBase + 1;

// The backend this demo calls (ESIGN_PORT_BASE + the service's offset, 0).
// Vite exposes process.env.VITE_* to import.meta.env, so defaulting it here
// is what makes `npm run web` reach THIS worktree's backend: the E2E configs
// and live-web.sh pass their own origin, but an interactive run passed
// nothing and src/config.ts fell back to a frozen :4100.
process.env.VITE_API_ORIGIN ||= `http://localhost:${portBase}`;

export default defineConfig(({ command }) => {
  if (command === 'build') {
    requireBuiltLibraries(packages);
  }
  return {
    plugins: [react()],
    server: { port: webPort, strictPort: true },
    preview: { port: webPort, strictPort: true },
    resolve: {
      alias: command === 'serve' ? sourceAliases(packages) : {},
    },
    test: {
      environment: 'jsdom',
      globals: true,
      // Tests are silent: fails a test on any console output
      setupFiles: ['./vitest.setup.ts'],
      include: [
        'src/**/*.test.{ts,tsx}',
        'e2e/**/*.test.ts',
        'vite/**/*.test.ts',
      ],
      coverage: {
        provider: 'v8',
        include: ['src/**/*.{ts,tsx}', 'e2e/ports.ts', 'vite/**/*.ts'],
        // vite-env.d.ts is type-only (nothing to cover)
        exclude: [
          'src/main.tsx',
          'src/vite-env.d.ts',
          'src/**/*.test.*',
          'vite/**/*.test.*',
        ],
        // json-summary feeds scripts/ci/coverage-empty.mjs (make coverage)
        reporter: ['text', 'json-summary', 'html'],
        // Demo app: unit-coverage floor at current level; the real coverage is
        // the Playwright E2E suites.
        thresholds: {
          statements: 100,
          branches: 100,
          functions: 100,
          lines: 100,
        },
      },
    },
  };
});
