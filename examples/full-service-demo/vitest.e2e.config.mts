import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: [
      // The workspace package straight from source (no build needed for tests);
      // the subpath first so the bare name does not swallow it
      {
        find: '@blinkbitcoin/esign-node/express',
        replacement: path.resolve(
          import.meta.dirname,
          '../../packages/esign-node/src/express.ts'
        ),
      },
      {
        find: '@blinkbitcoin/esign-node/knex',
        replacement: path.resolve(import.meta.dirname, '../../packages/esign-node/src/knex.ts'),
      },
      {
        find: '@blinkbitcoin/esign-node/docusign',
        replacement: path.resolve(
          import.meta.dirname,
          '../../packages/esign-node/src/docusign.ts'
        ),
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
    include: ['tests/e2e/**/*.e2e.test.ts'],
    testTimeout: 30000,
    // Run test files sequentially (equivalent to Jest's --runInBand) to
    // avoid parallel execution issues against the shared test database.
    fileParallelism: false,
  },
});
