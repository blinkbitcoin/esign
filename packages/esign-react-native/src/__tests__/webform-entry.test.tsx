// Guard: the ./webform entry must stay Apollo-free.
//
// Walks the static import graph from src/webform.ts - following relative
// imports AND crossing into @blinkbitcoin/esign-core's source (webform
// subpath) - and asserts no reached file imports '@apollo/' or 'graphql'.
// This is the package's guarantee that a Web Forms-only consumer never needs
// GraphQL dependencies installed.

import * as fs from 'fs';
import * as path from 'path';

const RN_SRC = path.resolve(__dirname, '..');
const CORE_SRC = path.resolve(__dirname, '../../../esign-core/src');
const CORE_PKG = '@blinkbitcoin/esign-core';

const IMPORT_RE =
  /(?:import|export)\s+(?:type\s+)?[^'"]*from\s+['"]([^'"]+)['"]/g;

const resolveRelative = (fromFile: string, spec: string): string | null => {
  const base = path.resolve(path.dirname(fromFile), spec);
  for (const candidate of [
    base + '.ts',
    base + '.tsx',
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
    const source = fs.readFileSync(file, 'utf8');
    for (const match of source.matchAll(IMPORT_RE)) {
      const spec = match[1];
      if (spec.startsWith('.')) {
        const resolved = resolveRelative(file, spec);
        if (resolved) {
          queue.push(resolved);
        }
      } else if (spec === CORE_PKG || spec.startsWith(`${CORE_PKG}/`)) {
        // Cross into the core package's source
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

describe('webform entry (Apollo-free guarantee, across packages)', () => {
  it('never reaches a file that imports @apollo/* or graphql', () => {
    const externals = collectExternals(path.join(RN_SRC, 'webform.ts'));

    const offenders = externals.filter(
      s =>
        s.startsWith('@apollo/') || s === 'graphql' || s.startsWith('graphql/'),
    );
    expect(offenders).toEqual([]);
    // Sanity: the graph did cross into RN + core code (webview/netinfo present)
    expect(externals).toEqual(
      expect.arrayContaining([
        'react-native-webview',
        '@react-native-community/netinfo',
      ]),
    );
  });

  it('the full index DOES reach Apollo (walker sanity check)', () => {
    const externals = collectExternals(path.join(RN_SRC, 'index.ts'));
    expect(externals.some(s => s.startsWith('@apollo/'))).toBe(true);
  });
});
