module.exports = {
  preset: '@react-native/jest-preset',
  testPathIgnorePatterns: ['/node_modules/'],
  transformIgnorePatterns: [
    'node_modules/(?!(@react-native|react-native|@apollo/client|graphql|react-native-webview)/)',
  ],
  moduleNameMapper: {
    '^@blinkbitcoin/esignature-core/webform$':
      '<rootDir>/../../packages/esignature-core/src/webform.ts',
    '^@blinkbitcoin/esign-react-native/webform$':
      '<rootDir>/../../packages/esign-react-native/src/webform.ts',
    '^@blinkbitcoin/esignature-core$':
      '<rootDir>/../../packages/esignature-core/src/index.ts',
    // Resolve the workspace library straight to source (no build needed)
    '^@blinkbitcoin/esign-react-native$':
      '<rootDir>/../../packages/esign-react-native/src/index.ts',
    // Native-module mocks: webview/netinfo live with the library, safe-area is demo-only
    '^react-native-webview$':
      '<rootDir>/../../packages/esign-react-native/__mocks__/react-native-webview.tsx',
    '^@react-native-community/netinfo$':
      '<rootDir>/../../packages/esign-react-native/__mocks__/@react-native-community/netinfo.ts',
    '^react-native-safe-area-context$':
      '<rootDir>/__mocks__/react-native-safe-area-context.tsx',
  },
  collectCoverageFrom: ['App.tsx', 'src/**/*.{ts,tsx}'],
  coveragePathIgnorePatterns: ['/node_modules/'],
  // Demo app: unit-coverage floor at current level; the real coverage is
  // the Maestro E2E suites.
  coverageThreshold: {
    global: { statements: 82, branches: 63, functions: 90, lines: 81 },
  },
};
