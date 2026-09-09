module.exports = {
  testEnvironment: 'jsdom',
  moduleNameMapper: {
    '^@blinkbitcoin/esign-react/docusign$': '<rootDir>/src/docusign.ts',
    '^@blinkbitcoin/esign-core/docusign$':
      '<rootDir>/../esign-core/src/docusign.ts',
    '^@blinkbitcoin/esign-core$': '<rootDir>/../esign-core/src/index.ts',
  },
  testPathIgnorePatterns: ['/node_modules/', '/dist/'],
  collectCoverageFrom: ['src/**/*.{ts,tsx}'],
  coveragePathIgnorePatterns: [
    '/node_modules/',
    // Generated from examples/full-service-demo/schema.graphql (see codegen.ts)
    'src/generated/',
    // Type-only file - no executable code to cover
    'src/types\\.ts$',
    // Pure re-export barrels - no executable logic
    'src/index\\.ts$',
    'src/docusign\\.ts$',
  ],
  // json-summary feeds scripts/coverage-badge.mjs (README badge + HTML report)
  coverageReporters: ['text', 'lcov', 'json-summary'],
  coverageThreshold: {
    global: { statements: 100, branches: 100, functions: 100, lines: 100 },
  },
};
