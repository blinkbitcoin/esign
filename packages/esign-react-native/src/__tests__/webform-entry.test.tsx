// Guard: the ./docusign and ./webform entries must stay Apollo-free.
//
// Walks the static import graph from each entry - following relative
// imports AND crossing into @blinkbitcoin/esign-core's source (its subpaths) - and asserts no reached file imports '@apollo/' or 'graphql'.
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

const collectGraph = (
  entry: string,
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
  return { files: [...seen], externals: [...externals] };
};

const collectExternals = (entry: string): string[] =>
  collectGraph(entry).externals;

/** Every .ts source under `dir` (recursively), tests excluded. */
const listSources = (dir: string): string[] =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return entry.name === '__tests__' ? [] : listSources(full);
    }
    return entry.name.endsWith('.ts') ? [full] : [];
  });

describe('the Apollo-free entries (webform, docusign), across packages', () => {
  it.each(['webform.ts', 'docusign.ts'])(
    '%s never reaches a file that imports @apollo/* or graphql',
    entry => {
      const externals = collectExternals(path.join(RN_SRC, entry));

      const offenders = externals.filter(
        s =>
          s.startsWith('@apollo/') ||
          s === 'graphql' ||
          s.startsWith('graphql/'),
      );
      expect(offenders).toEqual([]);
      // Sanity: the graph did cross into RN + core code (webview/netinfo present)
      expect(externals).toEqual(
        expect.arrayContaining([
          'react-native-webview',
          '@react-native-community/netinfo',
        ]),
      );
    },
  );

  it('the full index DOES reach Apollo (walker sanity check)', () => {
    const externals = collectExternals(path.join(RN_SRC, 'index.ts'));
    expect(externals.some(s => s.startsWith('@apollo/'))).toBe(true);
  });
});

// The invariant this package builds on: core's neutral signing/ layer never
// reaches a provider (the deprecated shims at the old signing/* paths of the
// DocuSign modules are re-exports and the one exception; core's own guard
// checks they carry no logic).
describe('provider boundary in core (signing/ never imports providers/)', () => {
  const SIGNING = path.join(CORE_SRC, 'signing');
  const DEPRECATED_SHIMS = [
    'events.ts',
    'index.ts',
    'mint.ts',
    'publicUrlSource.ts',
    'webFormsSource.ts',
  ].map(name => path.join(SIGNING, name));

  it('no signing/ module reaches a providers/ file', () => {
    const sources = listSources(SIGNING).filter(
      file => !DEPRECATED_SHIMS.includes(file),
    );
    expect(sources.length).toBeGreaterThan(5);
    for (const source of sources) {
      const reached = collectGraph(source).files.filter(file =>
        file.includes(`${path.sep}providers${path.sep}`),
      );
      expect({ source, reached }).toEqual({ source, reached: [] });
    }
  });
});
