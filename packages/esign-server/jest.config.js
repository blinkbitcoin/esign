module.exports = {
  testEnvironment: 'node',
  testPathIgnorePatterns: [
    '/node_modules/',
    '/dist/',
    '/__tests__/support\\.ts$',
  ],
  coveragePathIgnorePatterns: [
    '/node_modules/',
    'src/index\\.ts$',
    'src/knex\\.ts$', // re-exports only, like index.ts
    'src/docusign\\.ts$',
    // Deprecated re-export shims at the old paths - nothing to cover
    'src/bridgeScript\\.ts$',
    'src/prefill\\.ts$', // the ./docusign entry barrel (anchored: not src/docusign/)
    'src/types\\.ts$',
    // Test helpers are not product code
    '/__tests__/support\\.ts$',
  ],
  // json-summary feeds scripts/coverage-badge.mjs (README badge + HTML report)
  coverageReporters: ['text', 'lcov', 'json-summary'],
  coverageThreshold: {
    global: { statements: 100, branches: 100, functions: 100, lines: 100 },
  },
};
