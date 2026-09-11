import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { BASE_DEFAULT, BLOCK_STEP } from '../lib/ports.mjs';

// Drives scripts/e2e/ports.mjs (the I/O over scripts/lib/ports.mjs) against
// a throwaway repo with linked worktrees, never this repo's own .env.local.

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const PORTS_MJS = join(REPO_ROOT, 'scripts/e2e/ports.mjs');

const tempDirs = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop(), { recursive: true, force: true });
  }
});

function tempDir() {
  const dir = mkdtempSync(join(tmpdir(), 'ports-scripts-'));
  tempDirs.push(dir);
  return dir;
}

// Hermetic git: never the developer's global config or $HOME
const gitEnv = home => ({
  PATH: process.env.PATH,
  HOME: home,
  GIT_CONFIG_GLOBAL: '/dev/null',
});
const git = (cwd, args) =>
  execFileSync('git', args, { cwd, env: gitEnv(cwd), stdio: 'pipe' });

// A main clone with one commit and two linked worktrees next to it
function repoWithWorktrees() {
  const home = tempDir();
  const main = join(home, 'repo');
  git(home, ['init', '-q', '-b', 'main', main]);
  git(main, ['config', 'user.email', 'test@example.com']);
  git(main, ['config', 'user.name', 'Test']);
  writeFileSync(join(main, 'README.md'), '# fixture\n');
  git(main, ['add', '-A']);
  git(main, ['commit', '-q', '-m', 'chore: fixture']);
  const first = join(home, 'repo-first');
  const second = join(home, 'repo-second');
  git(main, ['worktree', 'add', '-q', first]);
  git(main, ['worktree', 'add', '-q', second]);
  return { home, main, first, second };
}

// The CLI in a checkout, with a clean environment (this shell's own
// ESIGN_PORT_BASE must never leak in)
function ports(cwd, home, args, env = {}) {
  return spawnSync(process.execPath, [PORTS_MJS, ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...gitEnv(home), ...env },
  });
}
const claimOf = dir => readFileSync(join(dir, '.env.local'), 'utf8');

describe('ports.mjs claim', () => {
  it('keeps the main clone on the default block and writes nothing there', () => {
    const { home, main } = repoWithWorktrees();
    const { status, stdout } = ports(main, home, ['claim']);
    expect(status).toBe(0);
    expect(stdout.trim()).toBe(String(BASE_DEFAULT));
    expect(() => claimOf(main)).toThrow(/ENOENT/);
  });

  it('claims the lowest free block for each linked worktree, once', () => {
    const { home, first, second } = repoWithWorktrees();
    expect(ports(first, home, ['claim']).stdout.trim()).toBe(
      String(BASE_DEFAULT + BLOCK_STEP),
    );
    expect(claimOf(first)).toContain(
      `ESIGN_PORT_BASE=${BASE_DEFAULT + BLOCK_STEP}\n`,
    );

    expect(ports(second, home, ['claim']).stdout.trim()).toBe(
      String(BASE_DEFAULT + 2 * BLOCK_STEP),
    );
    // A second run reads the claim back instead of claiming again
    const before = claimOf(first);
    expect(ports(first, home, ['claim']).stdout.trim()).toBe(
      String(BASE_DEFAULT + BLOCK_STEP),
    );
    expect(claimOf(first)).toBe(before);
  });

  it('skips a block a sibling claimed by hand and keeps other .env.local lines', () => {
    const { home, first, second } = repoWithWorktrees();
    writeFileSync(
      join(first, '.env.local'),
      `export ESIGN_PORT_BASE=${BASE_DEFAULT + BLOCK_STEP}\n`,
    );
    writeFileSync(join(second, '.env.local'), 'ESIGN_MODE=webform\n');
    expect(ports(second, home, ['claim']).stdout.trim()).toBe(
      String(BASE_DEFAULT + 2 * BLOCK_STEP),
    );
    expect(claimOf(second)).toBe(
      `ESIGN_MODE=webform\n# This worktree's port block (scripts/lib/ports.mjs; make ports shows it)\nESIGN_PORT_BASE=${BASE_DEFAULT + 2 * BLOCK_STEP}\n`,
    );
  });

  it('lets an explicit ESIGN_PORT_BASE win without touching .env.local', () => {
    const { home, first } = repoWithWorktrees();
    const { stdout } = ports(first, home, ['claim'], {
      ESIGN_PORT_BASE: '4300',
    });
    expect(stdout.trim()).toBe('4300');
    expect(() => claimOf(first)).toThrow(/ENOENT/);
  });

  it('falls back to the default outside a git checkout', () => {
    const dir = tempDir();
    const { status, stdout } = ports(dir, dir, ['claim'], {
      GIT_CEILING_DIRECTORIES: dir,
    });
    expect(status).toBe(0);
    expect(stdout.trim()).toBe(String(BASE_DEFAULT));
  });

  it('still prints the env lines and one port, and rejects an unknown word', () => {
    const { home, first } = repoWithWorktrees();
    expect(
      ports(first, home, ['env'], { ESIGN_PORT_BASE: '4300' }).stdout,
    ).toContain('export ESIGN_TEST_DB_PORT=4312');
    expect(
      ports(first, home, ['devDb'], { ESIGN_PORT_BASE: '4300' }).stdout.trim(),
    ).toBe('4313');
    const bad = ports(first, home, ['nope']);
    expect(bad.status).toBe(2);
    expect(bad.stderr).toContain('usage: ports.mjs env | claim |');
  });
});
