// The provider boundary, mechanically: every adapter lives under
// src/providers/<name>/ and the generic layer reaches a provider only through
// the few modules named here. A new import of providers/ anywhere else - or a
// provider importing another provider - fails this test rather than a review.
import * as fs from 'node:fs';
import * as path from 'node:path';

const SRC = path.resolve(__dirname, '..');
const PROVIDERS = path.join(SRC, 'providers');

// Generic modules allowed to import providers/, and why.
const ALLOWED_IMPORTERS = new Set([
  'registry.ts', // the composition root: providerFromEnv over every adapter
  'index.ts', // the root entry re-exports the adapters
  'docusign.ts', // the ./docusign entry
  'express.ts', // mounts the DocuSign pages next to the neutral ones (kept for the router's existing routes)
  'handlers.ts', // the DocuSign mint target + prefill validation stay the defaults (400 contract)
  // deprecated shims over providers/docusign at the pre-#74 paths, until the next major
  'pages.ts',
  'prefill.ts',
  'bridgeScript.ts',
  'types.ts',
]);

const listTs = (dir: string): string[] =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return entry.name === '__tests__' ? [] : listTs(full);
    }
    return entry.name.endsWith('.ts') ? [full] : [];
  });

const importsOf = (file: string): string[] =>
  [...fs.readFileSync(file, 'utf8').matchAll(/from '([^']+)'/g)].map(m => m[1]);

const providerOf = (file: string): string | undefined =>
  path.relative(PROVIDERS, file).split(path.sep)[0];

describe('provider boundary (src/providers/<name>/)', () => {
  const generic = listTs(SRC).filter(f => !f.startsWith(PROVIDERS));
  const adapters = fs
    .readdirSync(PROVIDERS, { withFileTypes: true })
    .filter(e => e.isDirectory())
    .map(e => e.name);

  it('every adapter is a directory under providers/ with a provider module', () => {
    expect(adapters.sort()).toEqual(['docusign', 'mock']);
    for (const name of adapters) {
      expect(fs.existsSync(path.join(PROVIDERS, name, 'provider.ts'))).toBe(
        true,
      );
    }
  });

  it('only the named generic modules import a provider', () => {
    expect(generic.length).toBeGreaterThan(10); // sanity: the walk saw src/
    const offenders = generic
      .filter(f => importsOf(f).some(spec => spec.includes('providers/')))
      .map(f => path.relative(SRC, f))
      .filter(rel => !ALLOWED_IMPORTERS.has(rel));
    expect(offenders).toEqual([]);
  });

  it('no provider imports another provider', () => {
    for (const file of listTs(PROVIDERS)) {
      const own = providerOf(file);
      const foreign = importsOf(file).filter(spec => {
        const target = path.resolve(path.dirname(file), spec);
        return target.startsWith(PROVIDERS) && providerOf(target) !== own;
      });
      expect({ file: path.relative(SRC, file), foreign }).toEqual({
        file: path.relative(SRC, file),
        foreign: [],
      });
    }
  });
});
