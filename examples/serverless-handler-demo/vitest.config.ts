import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: [
      // The workspace package straight from source (no build needed); the
      // subpath first so the bare name does not swallow it
      {
        find: '@blinkbitcoin/esign-server/docusign',
        replacement: path.resolve(
          import.meta.dirname,
          '../../packages/esign-server/src/docusign.ts',
        ),
      },
      {
        find: '@blinkbitcoin/esign-server',
        replacement: path.resolve(
          import.meta.dirname,
          '../../packages/esign-server/src/index.ts',
        ),
      },
    ],
  },
  test: {
    environment: 'node',
    globals: true,
    include: ['tests/**/*.test.ts'],
    // Tests are silent: fails a test on any console output
    setupFiles: ['./vitest.setup.ts'],
    coverage: {
      provider: 'v8',
      reportsDirectory: 'coverage',
      include: ['src/**/*.ts'],
      // index.ts binds a real port; the CI smoke runs it for real
      exclude: ['src/index.ts'],
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
