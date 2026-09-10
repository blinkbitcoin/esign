import { execFileSync, spawnSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

// Drives scripts/ci/changed-class.sh and scripts/ci/docs-freshness.sh against
// throwaway git repos, reproducing exactly the env contracts their callers in
// .github/workflows/checks.yml set up (see the `changes` and `docs` jobs).

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CHANGED_CLASS_SH = join(REPO_ROOT, 'scripts/ci/changed-class.sh');
const DOCS_FRESHNESS_SH = join(REPO_ROOT, 'scripts/ci/docs-freshness.sh');
const MANIFEST_HELPERS = [
  'scripts/ci/manifest-structural.mjs',
  'scripts/lib/manifest-structural.mjs',
];

const tempDirs = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop(), { recursive: true, force: true });
  }
});

function makeTempDir(prefix) {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

// Hermetic git env: never touch the developer's real global config, never
// let $HOME leak in.
function gitEnv(repoDir) {
  return {
    ...process.env,
    GIT_CONFIG_GLOBAL: '/dev/null',
    HOME: repoDir,
  };
}

function git(repoDir, args) {
  return execFileSync('git', args, { cwd: repoDir, env: gitEnv(repoDir) });
}

function writeFile(repoDir, relPath, content) {
  const full = join(repoDir, relPath);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, content);
}

function commit(repoDir, message) {
  git(repoDir, ['add', '-A']);
  git(repoDir, ['commit', '-q', '-m', message]);
  return git(repoDir, ['rev-parse', 'HEAD']).toString().trim();
}

// Builds a repo with one commit: a plain code file, a docs file and a
// mermaid diagram source/SVG pair, all already in sync - the common ancestor
// every scenario commits on top of.
function createFixtureRepo() {
  const dir = makeTempDir('ci-scripts-');
  git(dir, ['init', '-q', '-b', 'main']);
  git(dir, ['config', 'user.email', 'test@example.com']);
  git(dir, ['config', 'user.name', 'Test']);
  writeFile(dir, 'packages/esign-core/src/index.ts', 'export const x = 1;\n');
  writeFile(dir, 'docs/index.md', '# Docs\n');
  writeFile(dir, 'docs/diagrams/src/x.mmd', 'graph TD; A-->B;\n');
  writeFile(dir, 'docs/diagrams/dist/x.svg', '<svg><!-- v1 --></svg>\n');
  const initialSha = commit(dir, 'chore: initial commit');
  return { dir, initialSha };
}

// spawnSync, not execFileSync: stderr is part of what these tests assert
// (a green run must be quiet), so it is captured on success too.
function runScript(scriptPath, repoDir, env, extraArgs = []) {
  const result = spawnSync('bash', [scriptPath, ...extraArgs], {
    cwd: repoDir,
    env: { ...gitEnv(repoDir), ...env },
    encoding: 'utf8',
  });
  return {
    status: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

describe('changed-class.sh', () => {
  it('reports docs-only=true for a pull_request diff that only touches docs', () => {
    const { dir, initialSha } = createFixtureRepo();
    writeFile(dir, 'docs/index.md', '# Docs\n\nUpdated.\n');
    commit(dir, 'docs: update index');

    const outFile = join(dir, 'github-output');
    writeFileSync(outFile, '');
    const result = runScript(CHANGED_CLASS_SH, dir, {
      EVENT_NAME: 'pull_request',
      BASE_SHA: initialSha,
      GITHUB_OUTPUT: outFile,
    });

    expect(result.status).toBe(0);
    expect(readFileSync(outFile, 'utf8')).toBe('docs-only=true\n');
  });

  it('reports docs-only=false for a pull_request diff that also touches code', () => {
    const { dir, initialSha } = createFixtureRepo();
    writeFile(dir, 'docs/index.md', '# Docs\n\nUpdated.\n');
    writeFile(dir, 'packages/esign-core/src/index.ts', 'export const x = 2;\n');
    commit(dir, 'feat(core): change x and update docs');

    const outFile = join(dir, 'github-output');
    writeFileSync(outFile, '');
    const result = runScript(CHANGED_CLASS_SH, dir, {
      EVENT_NAME: 'pull_request',
      BASE_SHA: initialSha,
      GITHUB_OUTPUT: outFile,
    });

    expect(result.status).toBe(0);
    expect(readFileSync(outFile, 'utf8')).toBe('docs-only=false\n');
  });

  it('reports docs-only=false for a push event without classifying (no BASE_SHA needed)', () => {
    const { dir } = createFixtureRepo();
    writeFile(dir, 'docs/index.md', '# Docs\n\nUpdated.\n');
    commit(dir, 'docs: update index');

    const outFile = join(dir, 'github-output');
    writeFileSync(outFile, '');
    const result = runScript(CHANGED_CLASS_SH, dir, {
      EVENT_NAME: 'push',
      GITHUB_OUTPUT: outFile,
    });

    expect(result.status).toBe(0);
    expect(readFileSync(outFile, 'utf8')).toBe('docs-only=false\n');
  });

  it('reports docs-only=false for an empty diff', () => {
    const { dir, initialSha } = createFixtureRepo();

    const outFile = join(dir, 'github-output');
    writeFileSync(outFile, '');
    const result = runScript(CHANGED_CLASS_SH, dir, {
      EVENT_NAME: 'pull_request',
      BASE_SHA: initialSha,
      GITHUB_OUTPUT: outFile,
    });

    expect(result.status).toBe(0);
    expect(readFileSync(outFile, 'utf8')).toBe('docs-only=false\n');
  });
});

describe('docs-freshness.sh', () => {
  // The script `cd`s to its own repo root via dirname "$0", so it must live
  // inside the fixture repo at its real relative path for that resolution to
  // land on the fixture instead of the real repo.
  // The manifest classifier it shells out to comes along, at its real path.
  function installScript(dir) {
    for (const rel of MANIFEST_HELPERS) {
      const dest = join(dir, rel);
      mkdirSync(dirname(dest), { recursive: true });
      writeFileSync(dest, readFileSync(join(REPO_ROOT, rel)));
    }
    const dest = join(dir, 'scripts/ci/docs-freshness.sh');
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, readFileSync(DOCS_FRESHNESS_SH));
    execFileSync('chmod', ['+x', dest]);
    return 'scripts/ci/docs-freshness.sh';
  }

  function runDocsFreshness(dir, env) {
    const relScript = installScript(dir);
    const summaryFile = join(dir, 'github-step-summary');
    writeFileSync(summaryFile, '');
    const result = runScript(relScript, dir, {
      ...env,
      GITHUB_STEP_SUMMARY: summaryFile,
    });
    result.summary = readFileSync(summaryFile, 'utf8');
    return result;
  }

  it('warns (but exits 0) when an architecture-relevant file changes without a docs update', () => {
    const { dir } = createFixtureRepo();
    writeFile(dir, 'packages/esign-core/src/index.ts', 'export const x = 2;\n');
    commit(dir, 'feat(core): change x');

    const result = runDocsFreshness(dir, { EVENT_NAME: 'push' });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain(
      'Architecture-relevant files changed but docs were not updated:',
    );
    expect(result.summary).toContain('## Documentation Status');
    expect(result.summary).toContain(
      ':warning: Architecture-relevant files changed without a docs/ update:',
    );
    expect(result.summary).toContain('packages/esign-core/src/index.ts');
  });

  it('does not warn when the same architecture change also updates docs', () => {
    const { dir } = createFixtureRepo();
    writeFile(dir, 'packages/esign-core/src/index.ts', 'export const x = 2;\n');
    writeFile(dir, 'docs/index.md', '# Docs\n\nExplains x = 2.\n');
    commit(dir, 'feat(core): change x and update docs');

    const result = runDocsFreshness(dir, { EVENT_NAME: 'push' });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Docs check OK');
    expect(result.summary).toBe('');
  });

  it('fails hard when a diagram source changes without its rendered SVG', () => {
    const { dir } = createFixtureRepo();
    writeFile(dir, 'docs/diagrams/src/x.mmd', 'graph TD; A-->B-->C;\n');
    commit(dir, 'docs: edit diagram source only');

    const result = runDocsFreshness(dir, { EVENT_NAME: 'push' });

    expect(result.status).not.toBe(0);
    expect(result.stdout).toContain(
      "::error::Diagram sources changed without re-rendered SVGs: docs/diagrams/src/x.mmd - run 'make diagrams' and commit the SVGs",
    );
  });

  it('passes when both a diagram source and its rendered SVG change together', () => {
    const { dir } = createFixtureRepo();
    writeFile(dir, 'docs/diagrams/src/x.mmd', 'graph TD; A-->B-->C;\n');
    writeFile(dir, 'docs/diagrams/dist/x.svg', '<svg><!-- v2 --></svg>\n');
    commit(dir, 'docs: re-render diagram');

    const result = runDocsFreshness(dir, { EVENT_NAME: 'push' });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Docs check OK');
    expect(result.summary).toBe('');
  });

  const manifest = deps =>
    `${JSON.stringify({ name: 'x', scripts: { test: 'vitest' }, dependencies: deps }, null, 2)}\n`;

  function fixtureWithManifest() {
    const fixture = createFixtureRepo();
    writeFile(
      fixture.dir,
      'examples/react-demo/package.json',
      manifest({ vite: '^8.2.2' }),
    );
    commit(fixture.dir, 'chore: add manifest');
    return fixture;
  }

  it('does not count a package.json dependency bump as architecture-relevant', () => {
    const { dir } = fixtureWithManifest();
    writeFile(
      dir,
      'examples/react-demo/package.json',
      manifest({ vite: '^8.2.3' }),
    );
    commit(dir, 'chore(deps): bump vite');

    const result = runDocsFreshness(dir, { EVENT_NAME: 'push' });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Docs check OK');
    expect(result.summary).toBe('');
  });

  it('warns on a structural package.json change (an export, a script) without docs', () => {
    const { dir } = fixtureWithManifest();
    writeFile(
      dir,
      'examples/react-demo/package.json',
      manifest({ vite: '^8.2.2' }).replace(
        '"test": "vitest"',
        '"test": "vitest", "build": "vite build"',
      ),
    );
    commit(dir, 'feat(demo): build script');

    const result = runDocsFreshness(dir, { EVENT_NAME: 'push' });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain(
      'Architecture-relevant files changed but docs were not updated:',
    );
    expect(result.summary).toContain('examples/react-demo/package.json');
  });

  // A workspace renamed since the merge base has no manifest at the base:
  // that is the "structural" answer, not a failure, and git's own
  // "fatal: path ... exists on disk, but not in <ref>" must not reach the
  // terminal from a green run.
  it('classifies a manifest that did not exist at the base without printing git errors', () => {
    const { dir } = fixtureWithManifest();
    git(dir, ['mv', 'examples/react-demo', 'packages/esign-web']);
    commit(dir, 'refactor: promote the demo to a package');

    const result = runDocsFreshness(dir, { EVENT_NAME: 'push' });

    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.summary).toContain('packages/esign-web/package.json');
  });

  it('skips the warning entirely for a Dependabot-authored PR', () => {
    const { dir } = createFixtureRepo();
    writeFile(dir, 'packages/esign-core/src/index.ts', 'export const x = 2;\n');
    commit(dir, 'chore(deps): bump something');

    const result = runDocsFreshness(dir, {
      EVENT_NAME: 'push',
      PR_AUTHOR: 'dependabot[bot]',
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain(
      'Docs check OK (dependency update by Dependabot - no docs expected)',
    );
    expect(result.summary).toBe('');
  });

  it('diffs against the fetched origin/<BASE_REF> for a pull_request event', () => {
    // Reproduces the `docs` job's actual contract (EVENT_NAME=pull_request,
    // BASE_REF=github.base_ref): the script fetches origin/<BASE_REF> and
    // diffs that...HEAD, so the fixture needs a real "origin" remote.
    const { dir: upstream } = createFixtureRepo();
    const workDir = makeTempDir('ci-scripts-clone-');
    git(workDir, ['clone', '-q', upstream, '.']);
    git(workDir, ['config', 'user.email', 'test@example.com']);
    git(workDir, ['config', 'user.name', 'Test']);

    writeFile(
      workDir,
      'packages/esign-core/src/index.ts',
      'export const x = 2;\n',
    );
    commit(workDir, 'feat(core): change x');

    const result = runDocsFreshness(workDir, {
      EVENT_NAME: 'pull_request',
      BASE_REF: 'main',
    });

    expect(result.status).toBe(0);
    expect(result.summary).toContain('## Documentation Status');
    expect(result.summary).toContain('packages/esign-core/src/index.ts');
  });
});
