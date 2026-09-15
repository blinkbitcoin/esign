import { execFileSync, spawnSync } from 'node:child_process';
import {
  existsSync,
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

// Drives the CI shell/node scripts against throwaway fixtures, reproducing
// exactly the env contracts their callers in .github/workflows set up:
// changed-class.mjs and docs-freshness.sh against git repos (the `changes` and
// `docs` jobs in checks.yml), android-sdk-install.sh against a fake Android SDK
// root (the emulator install step in e2e.yml).
// What counts as documentation is scripts/lib/docs-only.test.mjs's table;
// these tests cover the other half - reading the right commit range.

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CHANGED_CLASS = join(REPO_ROOT, 'scripts/ci/changed-class.mjs');
const DOCS_FRESHNESS_SH = join(REPO_ROOT, 'scripts/ci/docs-freshness.sh');
const MAKE_PARITY = join(REPO_ROOT, 'scripts/ci/make-parity.mjs');
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
  const runner = scriptPath.endsWith('.mjs') ? process.execPath : 'bash';
  const result = spawnSync(runner, [scriptPath, ...extraArgs], {
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

// The classifier's output is read by ci.yml as a job output, so assert the
// exact bytes it writes to $GITHUB_OUTPUT, not just an exit code.
function classify(dir, env) {
  const outFile = join(dir, 'github-output');
  writeFileSync(outFile, '');
  const result = runScript(CHANGED_CLASS, dir, {
    ...env,
    GITHUB_OUTPUT: outFile,
  });
  return { ...result, output: readFileSync(outFile, 'utf8') };
}

describe('changed-class.mjs', () => {
  it('reports docs-only=true for a pull_request diff that only touches docs', () => {
    const { dir, initialSha } = createFixtureRepo();
    writeFile(dir, 'docs/index.md', '# Docs\n\nUpdated.\n');
    commit(dir, 'docs: update index');

    const result = classify(dir, {
      EVENT_NAME: 'pull_request',
      BASE_SHA: initialSha,
    });

    expect(result.status).toBe(0);
    expect(result.output).toBe('docs-only=true\n');
  });

  it('reports docs-only=false for a pull_request diff that also touches code', () => {
    const { dir, initialSha } = createFixtureRepo();
    writeFile(dir, 'docs/index.md', '# Docs\n\nUpdated.\n');
    writeFile(dir, 'packages/esign-core/src/index.ts', 'export const x = 2;\n');
    commit(dir, 'feat(core): change x and update docs');

    const result = classify(dir, {
      EVENT_NAME: 'pull_request',
      BASE_SHA: initialSha,
    });

    expect(result.status).toBe(0);
    expect(result.output).toBe('docs-only=false\n');
  });

  // A push is classified exactly like the PR it came from. This is the case
  // ci.yml used to hand to a paths-ignore list that did not know about
  // LICENSE, so the merge of a docs-only PR ran the whole matrix.
  it('classifies a push against the commit it replaced', () => {
    const { dir, initialSha } = createFixtureRepo();
    writeFile(dir, 'docs/index.md', '# Docs\n\nUpdated.\n');
    commit(dir, 'docs: update index');

    const result = classify(dir, { EVENT_NAME: 'push', BEFORE: initialSha });

    expect(result.status).toBe(0);
    expect(result.output).toBe('docs-only=true\n');
  });

  it('classifies a push of the per-package LICENSE copies as docs-only', () => {
    const { dir, initialSha } = createFixtureRepo();
    for (const pkg of ['esign-core', 'esign-node', 'esign-react']) {
      writeFile(dir, `packages/${pkg}/LICENSE`, 'Copyright (c) 2026 Blink\n');
    }
    writeFile(dir, 'LICENSE', 'Copyright (c) 2026 Blink\n');
    commit(dir, 'chore: drop the legal-entity name from the copyright line');

    const result = classify(dir, { EVENT_NAME: 'push', BEFORE: initialSha });

    expect(result.status).toBe(0);
    expect(result.output).toBe('docs-only=true\n');
  });

  it('reports docs-only=false for a push that touches code', () => {
    const { dir, initialSha } = createFixtureRepo();
    writeFile(dir, 'packages/esign-core/src/index.ts', 'export const x = 2;\n');
    commit(dir, 'feat(core): change x');

    const result = classify(dir, { EVENT_NAME: 'push', BEFORE: initialSha });

    expect(result.status).toBe(0);
    expect(result.output).toBe('docs-only=false\n');
  });

  // Fail open: an unreadable or absent base must never be read as "docs-only".
  it('reports docs-only=false for the first push of a branch (all-zero base)', () => {
    const { dir } = createFixtureRepo();
    writeFile(dir, 'docs/index.md', '# Docs\n\nUpdated.\n');
    commit(dir, 'docs: update index');

    const result = classify(dir, {
      EVENT_NAME: 'push',
      BEFORE: '0'.repeat(40),
    });

    expect(result.status).toBe(0);
    expect(result.output).toBe('docs-only=false\n');
  });

  it('reports docs-only=false when the base commit is unreachable', () => {
    const { dir } = createFixtureRepo();
    writeFile(dir, 'docs/index.md', '# Docs\n\nUpdated.\n');
    commit(dir, 'docs: update index');

    const result = classify(dir, {
      EVENT_NAME: 'push',
      BEFORE: 'f'.repeat(40),
    });

    expect(result.status).toBe(0);
    expect(result.output).toBe('docs-only=false\n');
  });

  it.each(['release', 'workflow_dispatch'])(
    'reports docs-only=false for %s - everything runs',
    eventName => {
      const { dir } = createFixtureRepo();
      writeFile(dir, 'docs/index.md', '# Docs\n\nUpdated.\n');
      commit(dir, 'docs: update index');

      const result = classify(dir, { EVENT_NAME: eventName });

      expect(result.status).toBe(0);
      expect(result.output).toBe('docs-only=false\n');
    },
  );

  it('reports docs-only=false for an empty diff', () => {
    const { dir, initialSha } = createFixtureRepo();

    const result = classify(dir, {
      EVENT_NAME: 'pull_request',
      BASE_SHA: initialSha,
    });

    expect(result.status).toBe(0);
    expect(result.output).toBe('docs-only=false\n');
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

// The gate's contract is its EXIT CODE - `make check-parity` is what CI runs,
// and a guard that reports "ok" while finding nothing is worse than no guard.
// scripts/lib/make-parity.test.mjs covers the rule; this covers the wiring:
// that it reads the Makefile and every workflow from the working directory.
describe('make-parity.mjs', () => {
  const fixture = (makefile, workflows) => {
    const dir = makeTempDir('make-parity-');
    writeFileSync(join(dir, 'Makefile'), makefile);
    mkdirSync(join(dir, '.github', 'workflows'), { recursive: true });
    for (const [name, body] of Object.entries(workflows)) {
      writeFileSync(join(dir, '.github', 'workflows', name), body);
    }
    return dir;
  };

  const run = dir => {
    const result = spawnSync(process.execPath, [MAKE_PARITY], {
      cwd: dir,
      encoding: 'utf8',
    });
    return { status: result.status, stdout: result.stdout ?? '' };
  };

  const MAKEFILE = [
    'e2e-server-demos: ## demos',
    '\tbash scripts/e2e/server-demos-smoke.sh',
    '',
    'docker-smoke: docker-build ## both modes',
    '\tbash scripts/ci/docker-smoke.sh esign-service',
  ].join('\n');

  it('exits 0 and says what it scanned when every step calls a target', () => {
    const dir = fixture(MAKEFILE, {
      'ci.yml': [
        'jobs:',
        '  a:',
        '    steps:',
        '      - run: make e2e-server-demos',
      ].join('\n'),
    });
    const { status, stdout } = run(dir);
    expect(status).toBe(0);
    expect(stdout).toContain('make parity: ok');
  });

  it('exits 1 and names the file, line and target for a duplicate', () => {
    const dir = fixture(MAKEFILE, {
      'e2e.yml': [
        'jobs:',
        '  a:',
        '    steps:',
        '      - run: bash scripts/e2e/server-demos-smoke.sh',
      ].join('\n'),
    });
    const { status, stdout } = run(dir);
    expect(status).toBe(1);
    expect(stdout).toContain('.github/workflows/e2e.yml:4');
    expect(stdout).toContain('make e2e-server-demos');
  });

  it('reads every workflow, not just the first', () => {
    const dir = fixture(MAKEFILE, {
      'a.yml': ['jobs:', '  a:', '    steps:', '      - run: make build'].join(
        '\n',
      ),
      'z.yml': [
        'jobs:',
        '  z:',
        '    steps:',
        '      - run: bash scripts/e2e/server-demos-smoke.sh',
      ].join('\n'),
    });
    const { status, stdout } = run(dir);
    expect(status).toBe(1);
    expect(stdout).toContain('z.yml');
  });

  // A target that also runs prerequisites is not "the" target for one of its
  // commands - the rule's reason, asserted end to end.
  it('does not flag a command belonging to a target with prerequisites', () => {
    const dir = fixture(MAKEFILE, {
      'e2e.yml': [
        'jobs:',
        '  a:',
        '    steps:',
        '      - run: bash scripts/ci/docker-smoke.sh esign-service',
      ].join('\n'),
    });
    expect(run(dir).status).toBe(0);
  });
});

describe('android-sdk-install.sh', () => {
  // A fake SDK root with a stub sdkmanager where the real one lives. The stub
  // appends its argv to a log and fails its first `failures` invocations, so a
  // test can assert both what the script asked for and how often it retried.
  function createSdkRoot({
    binDir = 'cmdline-tools/latest/bin',
    failures = 0,
  } = {}) {
    const dir = makeTempDir('android-sdk-');
    const log = join(dir, 'sdkmanager.log');
    if (binDir) {
      const bin = join(dir, binDir, 'sdkmanager');
      mkdirSync(dirname(bin), { recursive: true });
      writeFileSync(
        bin,
        [
          '#!/usr/bin/env bash',
          `echo "$@" >> ${JSON.stringify(log)}`,
          `attempts=$(wc -l < ${JSON.stringify(log)})`,
          `[ "$attempts" -gt ${failures} ] || { echo "Error on ZipFile unknown archive" >&2; exit 1; }`,
          'exit 0',
        ].join('\n'),
      );
      execFileSync('chmod', ['+x', bin]);
    }
    // The cache the script purges between attempts, so a test can see it go.
    mkdirSync(join(dir, '.downloadIntermediates'), { recursive: true });
    return { dir, log };
  }

  function runInstall(sdkRoot, env = {}, args = ['emulator']) {
    const result = runScript(
      join(REPO_ROOT, 'scripts/ci/android-sdk-install.sh'),
      sdkRoot,
      { ANDROID_HOME: sdkRoot, HOME: sdkRoot, ...env },
      args,
    );
    const calls = existsSync(join(sdkRoot, 'sdkmanager.log'))
      ? readFileSync(join(sdkRoot, 'sdkmanager.log'), 'utf8')
          .trim()
          .split('\n')
          .filter(Boolean)
      : [];
    return { ...result, calls };
  }

  // The regression this suite exists for: the script used to call a bare
  // `sdkmanager`, which is not on the runners' PATH, so every CI attempt died
  // with "command not found" in milliseconds and the retry loop hid it.
  it('runs the sdkmanager that ships inside the SDK root, not one from PATH', () => {
    const { dir } = createSdkRoot();

    const result = runInstall(dir, { PATH: '/usr/bin:/bin' });

    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
    expect(result.calls).toEqual(['--install emulator --channel=0']);
  });

  it('finds sdkmanager in a versioned cmdline-tools directory', () => {
    const { dir } = createSdkRoot({ binDir: 'cmdline-tools/13.0/bin' });

    expect(runInstall(dir).status).toBe(0);
  });

  it('falls back to ANDROID_SDK_ROOT when ANDROID_HOME is unset', () => {
    const { dir } = createSdkRoot();

    const result = runInstall(dir, { ANDROID_HOME: '', ANDROID_SDK_ROOT: dir });

    expect(result.status).toBe(0);
  });

  it('retries a failed install after purging the download cache, then succeeds', () => {
    const { dir } = createSdkRoot({ failures: 2 });

    const result = runInstall(dir);

    expect(result.status).toBe(0);
    expect(result.calls).toHaveLength(3);
    expect(result.stderr).toContain('retry 1 of 2');
    expect(result.stderr).toContain('retry 2 of 2');
    expect(existsSync(join(dir, '.downloadIntermediates'))).toBe(false);
  });

  it('gives up after the configured number of retries', () => {
    const { dir } = createSdkRoot({ failures: 99 });

    const result = runInstall(dir, { ANDROID_SDK_RETRIES: '1' });

    expect(result.status).toBe(1);
    expect(result.calls).toHaveLength(2);
    expect(result.stderr).toContain(
      "could not install 'emulator' in 2 attempts",
    );
  });

  // A missing binary is a broken runner image, not a flaky download: retrying
  // it just burns the budget and buries the real cause.
  it('fails immediately, without retrying, when the SDK holds no sdkmanager', () => {
    const { dir } = createSdkRoot({ binDir: null });

    const result = runInstall(dir);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(`no sdkmanager under ${dir}`);
    expect(result.stderr).not.toContain('retry');
  });

  it('fails when neither ANDROID_HOME nor ANDROID_SDK_ROOT is set', () => {
    const { dir } = createSdkRoot();

    const result = runInstall(dir, { ANDROID_HOME: '', ANDROID_SDK_ROOT: '' });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      'neither ANDROID_HOME nor ANDROID_SDK_ROOT is set',
    );
  });

  it('rejects a call that names no package', () => {
    const { dir } = createSdkRoot();

    const result = runInstall(dir, {}, []);

    expect(result.status).toBe(2);
    expect(result.stderr).toContain('usage:');
  });
});
