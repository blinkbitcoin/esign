import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: [
      // The workspace package straight from source (no build needed for tests);
      // the subpath first so the bare name does not swallow it
      {
        find: '@blinkbitcoin/esign-server/express',
        replacement: path.resolve(__dirname, '../../packages/esign-server/src/express.ts'),
      },
      {
        find: '@blinkbitcoin/esign-server/knex',
        replacement: path.resolve(__dirname, '../../packages/esign-server/src/knex.ts'),
      },
      {
        find: '@blinkbitcoin/esign-server/docusign',
        replacement: path.resolve(__dirname, '../../packages/esign-server/src/docusign.ts'),
      },
      {
        find: '@blinkbitcoin/esign-server',
        replacement: path.resolve(__dirname, '../../packages/esign-server/src/index.ts'),
      },
    ],
  },
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
