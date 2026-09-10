import path from 'node:path';
import { defineConfig } from 'vitest/config';

// Live verification against real DocuSign (see tests/live/). Opt-in via
// `npm run test:live` - excluded from the default suite and from CI. No
// setup file: these tests must use the real fetch and real modules.
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
    include: ['tests/live/**/*.live.test.ts'],
    testTimeout: 30000,
  },
});
