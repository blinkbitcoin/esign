import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['tests/e2e/**/*.e2e.test.ts'],
    testTimeout: 30000,
    // Run test files sequentially (equivalent to Jest's --runInBand) to
    // avoid parallel execution issues against the shared test database.
    fileParallelism: false,
  },
});
