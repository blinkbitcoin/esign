import fs from 'node:fs';
import path from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// The workspace libraries resolve straight to source while serving (`vite`
// dev server and vitest - no build needed), and to their built `dist` when
// building (`vite build`, which is what the Playwright E2E suites preview):
// the E2E then exercise exactly what a web consumer installs. `dist` comes
// from `npm run build` at the repo root (`make e2e-web*` runs it).
const packages = path.resolve(__dirname, '../../packages');
const sourceAlias = {
  '@blinkbitcoin/esign-react': `${packages}/esign-react/src/index.ts`,
  '@blinkbitcoin/esign-core/webform': `${packages}/esign-core/src/webform.ts`,
  '@blinkbitcoin/esign-core': `${packages}/esign-core/src/index.ts`,
};

// Without the alias, Rolldown's resolver still falls back to tsconfig.json's
// `paths` (also source) when a package's dist entry is missing - a build
// would silently bundle source and the E2E would prove nothing. Fail instead.
const requireBuiltLibraries = () => {
  for (const entry of [
    'esign-core/dist/index.mjs',
    'esign-react/dist/index.mjs',
  ]) {
    if (!fs.existsSync(`${packages}/${entry}`)) {
      throw new Error(
        `packages/${entry} is missing: run \`npm run build\` at the repo root before building the demo`,
      );
    }
  }
};

export default defineConfig(({ command }) => {
  if (command === 'build') {
    requireBuiltLibraries();
  }
  return {
    plugins: [react()],
    resolve: {
      alias: command === 'serve' ? sourceAlias : {},
    },
    test: {
      environment: 'jsdom',
      globals: true,
      include: ['src/**/*.test.{ts,tsx}'],
      coverage: {
        provider: 'v8',
        include: ['src/**/*.{ts,tsx}'],
        exclude: ['src/main.tsx', 'src/**/*.test.*'],
        // Demo app: unit-coverage floor at current level; the real coverage is
        // the Playwright E2E suites.
        thresholds: {
          statements: 100,
          branches: 100,
          functions: 100,
          lines: 100,
        },
      },
    },
  };
});
