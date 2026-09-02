module.exports = {
  preset: '@react-native/jest-preset',
  testPathIgnorePatterns: ['/node_modules/', '/lib/'],
  moduleNameMapper: {
    '^@blinkbitcoin/esign-core/webform$':
      '<rootDir>/../esign-core/src/webform.ts',
    '^@blinkbitcoin/esign-core$': '<rootDir>/../esign-core/src/index.ts',
    '^react-native-webview$': '<rootDir>/__mocks__/react-native-webview.tsx',
    '^@react-native-community/netinfo$':
      '<rootDir>/__mocks__/@react-native-community/netinfo.ts',
  },
  transformIgnorePatterns: [
    'node_modules/(?!(@react-native|react-native|@apollo/client|graphql|react-native-webview)/)',
  ],
  collectCoverageFrom: ['src/**/*.{ts,tsx}'],
  coveragePathIgnorePatterns: [
    '/node_modules/',
    // Generated from apps/api/schema.graphql (see codegen.ts)
    'src/generated/',
    // Type-only file - no executable code to cover
    'src/types\\.ts$',
    // Pure re-export barrel - no executable logic (istanbul reports 0/0)
    'src/index\\.ts$',
  ],
  // json-summary feeds scripts/coverage-badge.mjs (README badge + HTML report)
  coverageReporters: ['text', 'lcov', 'json-summary'],
  coverageThreshold: {
    global: { statements: 100, branches: 100, functions: 100, lines: 100 },
  },
};
