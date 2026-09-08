import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts', 'src/express.ts'],
  external: ['express'],
  format: ['esm', 'cjs'],
  platform: 'node',
  target: 'node18',
  dts: true,
  sourcemap: true,
  clean: true,
  outExtension: ({ format }) => ({ js: format === 'cjs' ? '.cjs' : '.mjs' }),
});
