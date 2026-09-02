module.exports = {
  testEnvironment: 'node',
  testPathIgnorePatterns: ['/node_modules/', '/dist/'],
  coveragePathIgnorePatterns: [
    '/node_modules/',
    'src/generated/',
    'src/types\\.ts$',
    'src/index\\.ts$',
    'src/webform\\.ts$',
  ],
  // json-summary feeds scripts/coverage-badge.mjs (README badge + HTML report)
  coverageReporters: ['text', 'lcov', 'json-summary'],
  coverageThreshold: {
    global: { statements: 100, branches: 100, functions: 100, lines: 100 },
  },
};
