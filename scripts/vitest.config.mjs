import { defineConfig } from 'vitest/config';

// Only lib/**: the CLI entry files (coverage-badge.mjs, status-badge.mjs,
// release/resolve-version.mjs) are thin wrappers over argv/env/git/fs/process
// and stay uncovered by design (same precedent as packages/esign-service/vitest.config.mts
// excluding the port-binding src/index.ts).
export default defineConfig({
  test: {
    include: ['**/*.test.mjs'],
    exclude: ['node_modules/**'],
    // Tests are silent: fails a test on any console output
    setupFiles: ['./vitest.setup.mjs'],
    coverage: {
      provider: 'v8',
      include: ['lib/**/*.mjs'],
      reporter: ['text', 'json-summary', 'html'],
      thresholds: {
        statements: 100,
        branches: 100,
        functions: 100,
        lines: 100,
      },
    },
  },
});
