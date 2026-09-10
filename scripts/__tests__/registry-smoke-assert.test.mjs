// Drives scripts/release/registry-smoke-assert.cjs `server` mode against a
// fabricated consumer project: the assertions are about what an installed
// tree looks like, so a real tree (built by hand, not by npm) is the fixture.
// The registry install itself is the Verify job's business; what is pinned
// here is that a mis-stamped publish actually fails the smoke.

import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const ASSERT = join(REPO_ROOT, 'scripts/release/registry-smoke-assert.cjs');
const VERSION = '1.2.3';

const tempDirs = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop(), { recursive: true, force: true });
  }
});

const writeJson = (file, value) => {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(value, null, 2));
};

const writePackage = (root, name, manifest, main = '') => {
  const dir = join(root, 'node_modules', name);
  writeJson(join(dir, 'package.json'), { name, main: 'index.js', ...manifest });
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'index.js'), main);
  return dir;
};

// A consumer project with both server packages installed, as npm would lay
// them out. Overrides let a single field drift the way a bad publish would.
const consumerProject = ({
  nodeVersion = VERSION,
  serviceVersion = VERSION,
  serviceDependsOn = VERSION,
  nestedNodeVersion,
} = {}) => {
  const root = mkdtempSync(join(tmpdir(), 'registry-smoke-'));
  tempDirs.push(root);
  writeJson(join(root, 'package.json'), { name: 'smoke', version: '1.0.0' });

  writePackage(
    root,
    '@blinkbitcoin/esign-node',
    { version: nodeVersion },
    'module.exports = { createWebFormInstance: () => {} };\n',
  );
  const service = writePackage(root, '@blinkbitcoin/esign-service', {
    version: serviceVersion,
    dependencies: { '@blinkbitcoin/esign-node': serviceDependsOn },
  });
  if (nestedNodeVersion) {
    // npm nests a second copy when the ranges disagree
    writeJson(
      join(service, 'node_modules/@blinkbitcoin/esign-node/package.json'),
      { name: '@blinkbitcoin/esign-node', version: nestedNodeVersion },
    );
  }
  return root;
};

const runAssert = (cwd, mode = 'server') =>
  spawnSync('node', [ASSERT, mode], {
    cwd,
    env: { ...process.env, VERSION },
    encoding: 'utf8',
  });

describe('registry-smoke-assert.cjs server', () => {
  it('passes when both packages carry the published version', () => {
    const result = runAssert(consumerProject());

    expect(result.status).toBe(0);
    expect(result.stdout).toContain(
      `verify: the server packages install stamped at ${VERSION}`,
    );
  });

  it('fails when esign-node was published unstamped', () => {
    const result = runAssert(
      consumerProject({ nodeVersion: '0.0.0-development' }),
    );

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('esign-node was published unstamped');
  });

  it('fails when esign-service was published unstamped', () => {
    const result = runAssert(
      consumerProject({ serviceVersion: '0.0.0-development' }),
    );

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('esign-service was published unstamped');
  });

  it('fails when the service asks for a version nobody published', () => {
    const result = runAssert(
      consumerProject({ serviceDependsOn: '0.0.0-development' }),
    );

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(
      'does not depend on esign-node at the published version',
    );
  });

  it('fails when the service resolves a different esign-node than it declares', () => {
    const result = runAssert(consumerProject({ nestedNodeVersion: '0.9.9' }));

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(
      'the esign-node the service resolves is not the published version',
    );
  });

  it('rejects an unknown mode', () => {
    const result = runAssert(consumerProject(), 'nope');

    expect(result.status).toBe(2);
    expect(result.stderr).toContain('usage: registry-smoke-assert.cjs');
  });
});
