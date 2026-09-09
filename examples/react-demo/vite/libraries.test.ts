import type fs from 'node:fs';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { requireBuiltLibraries, sourceAliases } from './libraries';

describe('sourceAliases', () => {
  it('maps each package alias to its source entry under the given packages dir', () => {
    const aliases = sourceAliases('/repo/packages');

    expect(aliases).toEqual({
      '@blinkbitcoin/esign-react/docusign':
        '/repo/packages/esign-react/src/docusign.ts',
      '@blinkbitcoin/esign-react': '/repo/packages/esign-react/src/index.ts',
      '@blinkbitcoin/esign-core/docusign':
        '/repo/packages/esign-core/src/docusign.ts',
      '@blinkbitcoin/esign-core/webform':
        '/repo/packages/esign-core/src/webform.ts',
      '@blinkbitcoin/esign-core': '/repo/packages/esign-core/src/index.ts',
    });
  });

  it('orders the subpath aliases before the bare package alias', () => {
    const aliases = sourceAliases('/repo/packages');

    expect(Object.keys(aliases)).toEqual([
      '@blinkbitcoin/esign-react/docusign',
      '@blinkbitcoin/esign-react',
      '@blinkbitcoin/esign-core/docusign',
      '@blinkbitcoin/esign-core/webform',
      '@blinkbitcoin/esign-core',
    ]);
  });
});

describe('requireBuiltLibraries', () => {
  let tempDir: string | undefined;

  afterEach(() => {
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
      tempDir = undefined;
    }
  });

  it('defaults to the real filesystem when no exists check is given', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'esign-libraries-test-'));
    mkdirSync(join(tempDir, 'esign-core', 'dist'), { recursive: true });
    writeFileSync(join(tempDir, 'esign-core', 'dist', 'index.mjs'), '');
    mkdirSync(join(tempDir, 'esign-react', 'dist'), { recursive: true });
    writeFileSync(join(tempDir, 'esign-react', 'dist', 'index.mjs'), '');

    expect(() => requireBuiltLibraries(tempDir as string)).not.toThrow();

    rmSync(join(tempDir, 'esign-core'), { recursive: true, force: true });

    expect(() => requireBuiltLibraries(tempDir as string)).toThrow(
      'packages/esign-core/dist/index.mjs is missing: run `npm run build` at the repo root before building the demo',
    );
  });

  it('passes when both built entries exist', () => {
    const exists = vi.fn().mockReturnValue(true);

    expect(() => requireBuiltLibraries('/repo/packages', exists)).not.toThrow();
  });

  it('checks esign-core before esign-react', () => {
    const exists = vi.fn().mockReturnValue(true);

    requireBuiltLibraries('/repo/packages', exists);

    expect(exists).toHaveBeenNthCalledWith(
      1,
      '/repo/packages/esign-core/dist/index.mjs',
    );
    expect(exists).toHaveBeenNthCalledWith(
      2,
      '/repo/packages/esign-react/dist/index.mjs',
    );
  });

  it('throws naming the first missing entry, checked in order', () => {
    const exists = vi.fn(
      (entry: fs.PathLike) => !entry.toString().includes('esign-core'),
    );

    expect(() => requireBuiltLibraries('/repo/packages', exists)).toThrow(
      'packages/esign-core/dist/index.mjs is missing: run `npm run build` at the repo root before building the demo',
    );
    expect(exists).toHaveBeenCalledTimes(1);
  });

  it('throws naming esign-react when only it is missing', () => {
    const exists = vi.fn(
      (entry: fs.PathLike) => !entry.toString().includes('esign-react'),
    );

    expect(() => requireBuiltLibraries('/repo/packages', exists)).toThrow(
      'packages/esign-react/dist/index.mjs is missing: run `npm run build` at the repo root before building the demo',
    );
    expect(exists).toHaveBeenCalledTimes(2);
  });
});
