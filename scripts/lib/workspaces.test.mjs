import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  dependencyStamps,
  INTERNAL_DEPENDENCIES,
  PUBLISHED_PACKAGES,
} from './workspaces.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const manifest = dir =>
  JSON.parse(readFileSync(join(root, dir, 'package.json'), 'utf8'));

// Every workspace directory the root manifest declares
const workspaces = () =>
  JSON.parse(
    readFileSync(join(root, 'package.json'), 'utf8'),
  ).workspaces.flatMap(pattern =>
    pattern.endsWith('/*')
      ? readdirSync(join(root, pattern.slice(0, -2)))
          .map(name => `${pattern.slice(0, -2)}/${name}`)
          .filter(dir => existsSync(join(root, dir, 'package.json')))
      : [pattern],
  );

describe('the release stamp table', () => {
  it('names every published package', () => {
    for (const dir of PUBLISHED_PACKAGES) {
      expect(manifest(dir).name).toMatch(/^@blinkbitcoin\//);
    }
  });

  it('lists every workspace that depends on a published package by version, and nothing else', () => {
    const published = new Set(
      PUBLISHED_PACKAGES.map(dir => manifest(dir).name),
    );
    const expected = {};
    for (const dir of workspaces()) {
      const { dependencies = {} } = manifest(dir);
      const internal = Object.keys(dependencies).filter(name =>
        published.has(name),
      );
      if (internal.length) {
        expected[dir] = internal.sort();
      }
    }
    const table = Object.fromEntries(
      Object.entries(INTERNAL_DEPENDENCIES).map(([dir, deps]) => [
        dir,
        [...deps].sort(),
      ]),
    );
    expect(table).toEqual(expected);
  });

  it('turns the table into one npm pkg set call per edge', () => {
    expect(
      dependencyStamps('1.2.3', {
        'examples/x': ['@blinkbitcoin/a', '@blinkbitcoin/b'],
      }),
    ).toEqual([
      {
        dir: 'examples/x',
        args: ['pkg', 'set', 'dependencies.@blinkbitcoin/a=1.2.3'],
      },
      {
        dir: 'examples/x',
        args: ['pkg', 'set', 'dependencies.@blinkbitcoin/b=1.2.3'],
      },
    ]);
    expect(dependencyStamps('0.0.1').length).toBeGreaterThan(0);
  });
});
