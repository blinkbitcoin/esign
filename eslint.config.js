// ESLint 9 flat config. The @react-native preset still ships in legacy
// eslintrc format, so it is adapted via FlatCompat. Biome handles formatting
// (and apps/api linting) - ESLint covers only the RN/web packages + demos.
const { FlatCompat } = require('@eslint/eslintrc');
const js = require('@eslint/js');

const compat = new FlatCompat({
  baseDirectory: __dirname,
  recommendedConfig: js.configs.recommended,
});

module.exports = [
  {
    // Replaces .eslintignore (unsupported in flat config)
    ignores: [
      '**/node_modules/**',
      'apps/api/**',
      '**/coverage/**',
      '**/ios/**',
      '**/android/**',
      '**/vendor/**',
      '**/lib/**',
      '**/dist/**',
      '**/generated/**',
    ],
  },
  ...compat.extends('@react-native'),
  {
    // Web package + web example: React-Native-specific rules don't apply
    // (inline styles are idiomatic DOM-React here, no RN APIs in play)
    files: ['packages/esign-react/**', 'examples/react-demo/**'],
    rules: {
      'react-native/no-inline-styles': 'off',
      'react-native/no-color-literals': 'off',
      'react-native/no-raw-text': 'off',
      'react-native/no-unused-styles': 'off',
    },
  },
];
