module.exports = {
  testEnvironment: 'jsdom',
  moduleNameMapper: {
    '^@blinkbitcoin/esign-core$': '<rootDir>/../esign-core/src/index.ts',
  },
  testPathIgnorePatterns: ['/node_modules/', '/dist/'],
  collectCoverageFrom: ['src/**/*.{ts,tsx}'],
  coveragePathIgnorePatterns: [
    '/node_modules/',
    // Generated from apps/api/schema.graphql (see codegen.ts)
    'src/generated/',
    // Type-only file - no executable code to cover
    'src/types\\.ts$',
    // Pure re-export barrel - no executable logic
    'src/index\\.ts$',
  ],
  // json-summary feeds scripts/coverage-badge.mjs (the README badge)
  coverageReporters: ['text', 'lcov', 'json-summary'],
  coverageThreshold: {
    global: { statements: 100, branches: 100, functions: 100, lines: 100 },
  },
};
