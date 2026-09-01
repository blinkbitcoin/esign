// Guard: the ./webform entry must stay Apollo-free.
//
// Walks the static import graph from src/webform.ts (following relative
// imports and @blinkbitcoin/esign-core/* self-references) and asserts no
// reached file imports '@apollo/' or 'graphql'. This is the guarantee that a
// Web Forms-only consumer never needs those packages installed.

import * as fs from 'fs';
import * as path from 'path';

const SRC = path.resolve(__dirname, '..');

// Matches static + type imports/re-exports: import ... from 'x' / export ... from 'x'
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

export const collectImportGraph = (
  entry: string,
  selfPackage: string,
  selfSrcDir: string,
): { files: string[]; externals: string[] } => {
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
      } else if (spec === selfPackage || spec.startsWith(`${selfPackage}/`)) {
        // Self-reference to this monorepo package: map onto its src entries
        const sub =
          spec === selfPackage ? 'index' : spec.slice(selfPackage.length + 1);
        const resolved = resolveRelative(
          path.join(selfSrcDir, 'x.ts'),
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
  return { files: [...seen], externals: [...externals] };
};

describe('webform entry (Apollo-free guarantee)', () => {
  it('never reaches a file that imports @apollo/* or graphql', () => {
    const { files, externals } = collectImportGraph(
      path.join(SRC, 'webform.ts'),
      '@blinkbitcoin/esign-core',
      SRC,
    );

    expect(files.length).toBeGreaterThan(3); // sanity: the walk followed the graph
    const offenders = externals.filter(
      spec =>
        spec.startsWith('@apollo/') ||
        spec === 'graphql' ||
        spec.startsWith('graphql/'),
    );
    expect(offenders).toEqual([]);
  });

  it('the full index DOES reach Apollo (sanity check that the walker works)', () => {
    const { externals } = collectImportGraph(
      path.join(SRC, 'index.ts'),
      '@blinkbitcoin/esign-core',
      SRC,
    );
    expect(externals.some(spec => spec.startsWith('@apollo/'))).toBe(true);
  });
});
