import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['tests/**/*.test.ts'],
    // e2e has its own config; live/ hits real DocuSign and is opt-in only
    exclude: ['tests/e2e/**', 'tests/live/**'],
    setupFiles: ['./tests/setup.ts'],
    coverage: {
      provider: 'v8',
      reportsDirectory: 'coverage',
      include: ['src/**/*.ts'],
      // index.ts is the server bootstrap (binds a real port, never imported
      // by tests) and is not meaningfully unit-testable.
      exclude: ['src/generated/**', 'src/index.ts'],
      thresholds: { statements: 100, branches: 100, functions: 100, lines: 100 },
    },
  },
});
