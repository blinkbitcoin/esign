import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts', 'src/webform.ts', 'src/docusign.ts'],
  // Build without the tests: the parity test imports the Node package's
  // source, which would pull a file from outside this package into the tree
  tsconfig: 'tsconfig.build.json',
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: true,
  clean: true,
  external: ['@apollo/client', 'graphql'],
  outExtension: ({ format }) => ({ js: format === 'cjs' ? '.cjs' : '.mjs' }),
});
