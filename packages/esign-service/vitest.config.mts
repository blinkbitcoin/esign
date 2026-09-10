import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: [
      // The workspace package straight from source (no build needed for tests);
      // the subpath first so the bare name does not swallow it
      {
        find: '@blinkbitcoin/esign-node/express',
        replacement: path.resolve(import.meta.dirname, '../../packages/esign-node/src/express.ts'),
      },
      {
        find: '@blinkbitcoin/esign-node/knex',
        replacement: path.resolve(import.meta.dirname, '../../packages/esign-node/src/knex.ts'),
      },
      {
        find: '@blinkbitcoin/esign-node/docusign',
        replacement: path.resolve(import.meta.dirname, '../../packages/esign-node/src/docusign.ts'),
      },
      {
        find: '@blinkbitcoin/esign-node',
        replacement: path.resolve(import.meta.dirname, '../../packages/esign-node/src/index.ts'),
      },
    ],
  },
  test: {
    environment: 'node',
    globals: true,
    include: ['tests/**/*.test.ts'],
    // e2e has its own config; live/ hits real DocuSign and is opt-in only
    exclude: ['tests/e2e/**', 'tests/live/**'],
    // Tests are silent (vitest.setup.ts fails a test on any console output)
    setupFiles: ['./vitest.setup.ts', './tests/setup.ts'],
    coverage: {
      provider: 'v8',
      reportsDirectory: 'coverage',
      include: ['src/**/*.ts'],
      // index.ts is the server bootstrap (binds a real port, never imported
      // by tests) and is not meaningfully unit-testable.
      // ... plus the re-export / type-only modules (nothing to cover):
      // errors, typeDefs, types and providers/port re-export the package
      exclude: [
        'src/generated/**',
        // A test double (knex-mock-client) that happens to live in src/
        'src/__mocks__/**',
        // The process entry point (dotenv + telemetry ordering, then the
        // server or the migration) - never imported by a test
        'src/node.ts',
        // Re-export / type-only modules (nothing to cover): the library
        // barrel, and the modules that re-export the package's surface
        'src/index.ts',
        'src/errors.ts',
        'src/typeDefs.ts',
        'src/types.ts',
        'src/providers/port.ts',
      ],
      // json-summary feeds scripts/coverage-badge.mjs (README badge + HTML report)
      reporter: ['text', 'json-summary', 'html'],
      thresholds: { statements: 100, branches: 100, functions: 100, lines: 100 },
    },
  },
});
