import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts', 'src/docusign.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: true,
  clean: true,
  external: ['react', '@apollo/client', 'graphql', '@blinkbitcoin/esign-core'],
  outExtension: ({ format }) => ({ js: format === 'cjs' ? '.cjs' : '.mjs' }),
});
