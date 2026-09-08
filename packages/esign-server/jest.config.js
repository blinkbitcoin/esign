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
    'src/types\\.ts$',
  ],
  // json-summary feeds scripts/coverage-badge.mjs (README badge + HTML report)
  coverageReporters: ['text', 'lcov', 'json-summary'],
  coverageThreshold: {
    global: { statements: 100, branches: 100, functions: 100, lines: 100 },
  },
};
