import { defineConfig } from 'vitest/config';

// Only lib/**: the CLI entry files (coverage-badge.mjs, status-badge.mjs,
// release/resolve-version.mjs) are thin wrappers over argv/env/git/fs/process
// and stay uncovered by design (same precedent as examples/full-service-demo/vitest.config.ts
// excluding the port-binding src/index.ts).
export default defineConfig({
  test: {
    include: ['**/*.test.mjs'],
    exclude: ['node_modules/**'],
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
