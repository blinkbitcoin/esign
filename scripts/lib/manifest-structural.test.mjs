import { describe, expect, it } from 'vitest';
import {
  DEPENDENCY_KEYS,
  isStructuralManifestChange,
} from './manifest-structural.mjs';

const base = {
  name: 'x',
  version: '1.0.0',
  exports: { '.': './dist/index.js' },
  scripts: { test: 'vitest' },
  dependencies: { a: '^1.0.0' },
  devDependencies: { b: '^2.0.0' },
};

describe('isStructuralManifestChange', () => {
  it('ignores dependency range and version bumps', () => {
    const bumped = {
      ...base,
      version: '1.1.0',
      dependencies: { a: '^1.2.0', c: '^3.0.0' },
      devDependencies: {},
      peerDependencies: { d: '*' },
      overrides: { e: '1.0.0' },
    };
    expect(isStructuralManifestChange(base, bumped)).toBe(false);
  });

  it('ignores key order', () => {
    const reordered = {
      scripts: base.scripts,
      exports: base.exports,
      name: 'x',
      version: '1.0.0',
    };
    expect(
      isStructuralManifestChange(base, {
        ...reordered,
        dependencies: base.dependencies,
        devDependencies: base.devDependencies,
      }),
    ).toBe(false);
  });

  it('flags exports, scripts, workspaces and identity changes', () => {
    expect(
      isStructuralManifestChange(base, {
        ...base,
        exports: { '.': './dist/index.js', './x': './dist/x.js' },
      }),
    ).toBe(true);
    expect(
      isStructuralManifestChange(base, { ...base, scripts: { test: 'jest' } }),
    ).toBe(true);
    expect(
      isStructuralManifestChange(base, { ...base, workspaces: ['packages/*'] }),
    ).toBe(true);
    expect(isStructuralManifestChange(base, { ...base, name: 'y' })).toBe(true);
  });

  it('treats an added or deleted manifest as structural', () => {
    expect(isStructuralManifestChange(undefined, base)).toBe(true);
    expect(isStructuralManifestChange(base, null)).toBe(true);
  });

  it('names the dependency keys it ignores', () => {
    expect(DEPENDENCY_KEYS).toContain('dependencies');
    expect(DEPENDENCY_KEYS).toContain('version');
  });
});
