import fs from 'node:fs';

// The workspace libraries resolve straight to source while serving (`vite`
// dev server and vitest - no build needed), and to their built `dist` when
// building (`vite build`, which is what the Playwright E2E suites preview):
// the E2E then exercise exactly what a web consumer installs. `dist` comes
// from `npm run build` at the repo root (`make e2e-web*` runs it).
export const sourceAliases = (packagesDir: string) => ({
  '@blinkbitcoin/esign-react/docusign': `${packagesDir}/esign-react/src/docusign.ts`,
  '@blinkbitcoin/esign-react': `${packagesDir}/esign-react/src/index.ts`,
  '@blinkbitcoin/esign-core/docusign': `${packagesDir}/esign-core/src/docusign.ts`,
  '@blinkbitcoin/esign-core/webform': `${packagesDir}/esign-core/src/webform.ts`,
  '@blinkbitcoin/esign-core': `${packagesDir}/esign-core/src/index.ts`,
});

// Without the alias, Rolldown's resolver still falls back to tsconfig.json's
// `paths` (also source) when a package's dist entry is missing - a build
// would silently bundle source and the E2E would prove nothing. Fail instead.
export const requireBuiltLibraries = (
  packagesDir: string,
  exists = fs.existsSync,
) => {
  for (const entry of [
    'esign-core/dist/index.mjs',
    'esign-react/dist/index.mjs',
  ]) {
    if (!exists(`${packagesDir}/${entry}`)) {
      throw new Error(
        `packages/${entry} is missing: run \`npm run build\` at the repo root before building the demo`,
      );
    }
  }
};
