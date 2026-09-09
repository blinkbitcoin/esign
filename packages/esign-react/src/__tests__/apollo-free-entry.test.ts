// Guard: the ./docusign entry must stay Apollo-free. Walks the static import
// graph from it - relative imports, and crossing into @blinkbitcoin/esign-core's
// source through its subpaths - and asserts no reached file imports
// '@apollo/' or 'graphql'. A browser app that only needs DocuSign Web Forms
// installs this package without the GraphQL peers.

import * as fs from 'fs';
import * as path from 'path';

const WEB_SRC = path.resolve(__dirname, '..');
const CORE_SRC = path.resolve(__dirname, '../../../esign-core/src');
const CORE_PKG = '@blinkbitcoin/esign-core';

const IMPORT_RE =
  /(?:import|export)\s+(?:type\s+)?[^'"]*from\s+['"]([^'"]+)['"]/g;

const resolveRelative = (fromFile: string, spec: string): string | null => {
  const base = path.resolve(path.dirname(fromFile), spec);
  for (const candidate of [
    `${base}.ts`,
    `${base}.tsx`,
    path.join(base, 'index.ts'),
  ]) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
};

const collectExternals = (entry: string): string[] => {
  const seen = new Set<string>();
  const externals = new Set<string>();
  const queue = [entry];
  while (queue.length > 0) {
    const file = queue.pop() as string;
    if (seen.has(file)) {
      continue;
    }
    seen.add(file);
    for (const match of fs.readFileSync(file, 'utf8').matchAll(IMPORT_RE)) {
      const spec = match[1];
      if (spec.startsWith('.')) {
        const resolved = resolveRelative(file, spec);
        if (resolved) {
          queue.push(resolved);
        }
      } else if (spec === CORE_PKG || spec.startsWith(`${CORE_PKG}/`)) {
        const sub =
          spec === CORE_PKG ? 'index' : spec.slice(CORE_PKG.length + 1);
        const resolved = resolveRelative(
          path.join(CORE_SRC, 'x.ts'),
          `./${sub}`,
        );
        if (resolved) {
          queue.push(resolved);
        }
      } else {
        externals.add(spec);
      }
    }
  }
  return [...externals];
};

describe('the ./docusign entry, across packages', () => {
  it('never reaches a file that imports @apollo/* or graphql', () => {
    const externals = collectExternals(path.join(WEB_SRC, 'docusign.ts'));
    const offenders = externals.filter(
      s =>
        s.startsWith('@apollo/') || s === 'graphql' || s.startsWith('graphql/'),
    );
    expect(offenders).toEqual([]);
    // Sanity: the walk did cross into core and saw the React peer
    expect(externals).toContain('react');
  });

  it('the root entry does reach Apollo (the walker is not vacuous)', () => {
    const externals = collectExternals(path.join(WEB_SRC, 'index.ts'));
    expect(externals.some(s => s.startsWith('@apollo/'))).toBe(true);
  });
});
