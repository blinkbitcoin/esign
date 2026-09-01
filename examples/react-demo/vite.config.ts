import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // Resolve the workspace libraries straight to source (no build needed)
      '@blinkbitcoin/esign-react': path.resolve(
        __dirname,
        '../../packages/esign-react/src/index.ts',
      ),
      '@blinkbitcoin/esign-core/webform': path.resolve(
        __dirname,
        '../../packages/esign-core/src/webform.ts',
      ),
      '@blinkbitcoin/esign-core': path.resolve(
        __dirname,
        '../../packages/esign-core/src/index.ts',
      ),
    },
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
      thresholds: { statements: 82, branches: 66, functions: 88, lines: 81 },
    },
  },
});
