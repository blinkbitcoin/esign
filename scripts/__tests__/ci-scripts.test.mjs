import { execFileSync } from 'node:child_process';
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

// Drives scripts/ci/changed-class.sh and scripts/ci/docs-freshness.sh against
// throwaway git repos, reproducing exactly the env contracts their callers in
// .github/workflows/checks.yml set up (see the `changes` and `docs` jobs).

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CHANGED_CLASS_SH = join(REPO_ROOT, 'scripts/ci/changed-class.sh');
const DOCS_FRESHNESS_SH = join(REPO_ROOT, 'scripts/ci/docs-freshness.sh');

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

function runScript(scriptPath, repoDir, env, extraArgs = []) {
  try {
    const stdout = execFileSync('bash', [scriptPath, ...extraArgs], {
      cwd: repoDir,
      env: { ...gitEnv(repoDir), ...env },
    });
    return { status: 0, stdout: stdout.toString(), stderr: '' };
  } catch (error) {
    return {
      status: error.status,
      stdout: (error.stdout ?? '').toString(),
      stderr: (error.stderr ?? '').toString(),
    };
  }
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
  function installScript(dir) {
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
