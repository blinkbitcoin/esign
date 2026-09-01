import { defineConfig } from 'vitest/config';

// Live verification against real DocuSign (see tests/live/). Opt-in via
// `npm run test:live` - excluded from the default suite and from CI. No
// setup file: these tests must use the real fetch and real modules.
export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['tests/live/**/*.live.test.ts'],
    testTimeout: 30000,
  },
});
