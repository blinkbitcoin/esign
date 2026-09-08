import path from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';
import { requireBuiltLibraries, sourceAliases } from './vite/libraries';

const packages = path.resolve(__dirname, '../../packages');

export default defineConfig(({ command }) => {
  if (command === 'build') {
    requireBuiltLibraries(packages);
  }
  return {
    plugins: [react()],
    resolve: {
      alias: command === 'serve' ? sourceAliases(packages) : {},
    },
    test: {
      environment: 'jsdom',
      globals: true,
      include: [
        'src/**/*.test.{ts,tsx}',
        'e2e/**/*.test.ts',
        'vite/**/*.test.ts',
      ],
      coverage: {
        provider: 'v8',
        include: ['src/**/*.{ts,tsx}', 'e2e/ports.ts', 'vite/**/*.ts'],
        exclude: ['src/main.tsx', 'src/**/*.test.*', 'vite/**/*.test.*'],
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
