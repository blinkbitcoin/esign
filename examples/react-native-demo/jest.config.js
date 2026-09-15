// A worktree claims its own port block into .env.local and direnv exports
// ESIGN_PORT_BASE from it, so a developer's shell carries a base that is not
// the documented 4100 these tests assert. That is machine state, not a
// property of the code under test. It has to be cleared HERE, not in
// jest.setup.ts: babel.config.js inlines ESIGN_PORT_BASE into the demo's
// modules at transform time (the RN bundle has no process.env at runtime),
// so by the time a setup file runs the value is already baked in. This file
// is evaluated by the jest CLI before any worker transforms anything.
// Empty, not deleted: every reader in the repo treats an empty value as
// unset. A test that exercises the derivation passes the base explicitly
// (resolveBackendPort takes it as an argument).
process.env.ESIGN_PORT_BASE = '';

module.exports = {
  // Tests are silent: fails a test on any console output (jest.setup.ts)
  setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
  preset: '@react-native/jest-preset',
  testPathIgnorePatterns: ['/node_modules/'],
  transformIgnorePatterns: [
    'node_modules/(?!(@react-native|react-native|@apollo/client|graphql|react-native-webview)/)',
  ],
  moduleNameMapper: {
    '^@blinkbitcoin/esign-core/docusign$':
      '<rootDir>/../../packages/esign-core/src/docusign.ts',
    '^@blinkbitcoin/esign-core/webform$':
      '<rootDir>/../../packages/esign-core/src/webform.ts',
    '^@blinkbitcoin/esign-react-native/docusign$':
      '<rootDir>/../../packages/esign-react-native/src/docusign.ts',
    '^@blinkbitcoin/esign-react-native/webform$':
      '<rootDir>/../../packages/esign-react-native/src/webform.ts',
    '^@blinkbitcoin/esign-core$':
      '<rootDir>/../../packages/esign-core/src/index.ts',
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
    global: { statements: 100, branches: 100, functions: 100, lines: 100 },
  },
};
