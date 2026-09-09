// Guards on the source layout:
//
// 1. The ./docusign and ./webform entries must stay Apollo-free. Walks the
//    static import graph from each entry (following relative imports and
//    @blinkbitcoin/esign-core/* self-references) and asserts no reached file
//    imports '@apollo/' or 'graphql' - the guarantee that a Web Forms-only
//    consumer never needs those packages installed.
// 2. The provider boundary: nothing under signing/ (the neutral layer) may
//    reach providers/ - a provider binds itself on top of signing/, never the
//    other way round. The deprecated shims that keep the old signing/* paths
//    of DocuSign's modules alive are the one exception, and they must carry
//    no logic of their own (re-exports only).

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

/** Every .ts source under `dir` (recursively), tests excluded. */
export const listSources = (dir: string): string[] =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return entry.name === '__tests__' ? [] : listSources(full);
    }
    return entry.name.endsWith('.ts') ? [full] : [];
  });

// Comments, then the statements a logic-free shim may consist of: imports,
// re-exports, and one-name aliases (`export const x = y;` / `export type X = Y;`)
const COMMENT_RE = /\/\*[\s\S]*?\*\/|\/\/.*$/gm;
const SHIM_STATEMENT_RE =
  /^(?:import\s[\s\S]*?\sfrom\s+'[^']+'|export\s+(?:type\s+)?\{[\s\S]*?\}\s+from\s+'[^']+'|export\s+const\s+\w+\s*=\s*\w+|export\s+type\s+\w+\s*=\s*[\w.]+)$/;

/** True when the file is nothing but imports, re-exports and one-name aliases. */
export const isReExportOnly = (file: string): boolean =>
  fs
    .readFileSync(file, 'utf8')
    .replace(COMMENT_RE, '')
    .split(';')
    .map(statement => statement.trim())
    .filter(statement => statement.length > 0)
    .every(statement => SHIM_STATEMENT_RE.test(statement));

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

describe('the Apollo-free entries (webform, docusign)', () => {
  it.each(['webform.ts', 'docusign.ts'])(
    '%s never reaches a file that imports @apollo/* or graphql',
    entry => {
      const { files, externals } = collectImportGraph(
        path.join(SRC, entry),
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
    },
  );

  it('the full index DOES reach Apollo (sanity check that the walker works)', () => {
    const { externals } = collectImportGraph(
      path.join(SRC, 'index.ts'),
      '@blinkbitcoin/esign-core',
      SRC,
    );
    expect(externals.some(spec => spec.startsWith('@apollo/'))).toBe(true);
  });
});

describe('provider boundary (signing/ never imports providers/)', () => {
  const SIGNING = path.join(SRC, 'signing');
  // The deprecated shims over providers/docusign at the old signing/* paths
  // (+ the signing barrel, which re-exports them for the old module path)
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
    expect(sources.length).toBeGreaterThan(5); // sanity: the listing walked signing/
    for (const source of sources) {
      const { files } = collectImportGraph(
        source,
        '@blinkbitcoin/esign-core',
        SRC,
      );
      const reached = files.filter(file =>
        file.includes(`${path.sep}providers${path.sep}`),
      );
      expect({ source, reached }).toEqual({ source, reached: [] });
    }
  });

  it('the deprecated shims exist, are marked, and carry no logic', () => {
    for (const shim of DEPRECATED_SHIMS) {
      expect(fs.existsSync(shim)).toBe(true);
      expect(fs.readFileSync(shim, 'utf8')).toContain('@deprecated');
      expect({ shim, reExportOnly: isReExportOnly(shim) }).toEqual({
        shim,
        reExportOnly: true,
      });
    }
  });

  it('isReExportOnly rejects a file with logic (walker sanity check)', () => {
    expect(isReExportOnly(path.join(SIGNING, 'bridge.ts'))).toBe(false);
  });
});
