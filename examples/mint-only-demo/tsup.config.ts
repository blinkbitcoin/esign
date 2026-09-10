import { defineConfig } from 'tsup';

// tsc would emit extension-less ESM `import` specifiers ('./mint', not
// './mint.js'), which plain Node cannot resolve; tsup rewrites them.
export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  platform: 'node',
  target: 'node22',
  clean: true,
  sourcemap: true,
});
