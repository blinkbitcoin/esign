import { execFileSync, spawnSync } from 'node:child_process';
import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { connect } from 'node:net';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
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

// Real paths: git and lsof report them, and macOS's tmpdir is a symlink
function tempDir() {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'ports-scripts-')));
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

// A fake `lsof` and `docker` on PATH answering with the given listeners and
// containers, so the table reads exactly what the test says is there. A
// listener is reported only while its pid is alive, so a `free` run sees
// the port empty on its second look, like the real lsof would.
function fakeTools({ listeners = [], cwds = {}, containers = [] }) {
  const bin = tempDir();
  const listenerBlocks = listeners.map(
    ({ pid, command, port }) =>
      `kill -0 ${pid} 2>/dev/null && printf '%s\\n' 'p${pid}' 'c${command}' 'f12' 'n*:${port}'`,
  );
  const cwdLines = Object.entries(cwds).flatMap(([pid, cwd]) => [
    `p${pid}`,
    'fcwd',
    `n${cwd}`,
  ]);
  writeFileSync(
    join(bin, 'lsof'),
    [
      '#!/usr/bin/env bash',
      'case "$*" in',
      `  *-d*cwd*) printf '%s\\n' ${cwdLines.map(l => `'${l}'`).join(' ')} ;;`,
      '  *)',
      ...listenerBlocks.map(block => `    ${block}`),
      '    ;;',
      'esac',
      'exit 0',
      '',
    ].join('\n'),
  );
  writeFileSync(
    join(bin, 'docker'),
    [
      '#!/usr/bin/env bash',
      '# `ps` lists the containers until a `compose ... down` ran',
      `[ "$1" = ps ] && [ ! -f "$(dirname "$0")/downed" ] && printf '%s\\n' ${containers.map(c => `'${c}'`).join(' ')}`,
      'echo "$*" >> "$(dirname "$0")/docker-calls"',
      'case "$*" in *" down") touch "$(dirname "$0")/downed" ;; esac',
      'exit 0',
      '',
    ].join('\n'),
  );
  chmodSync(join(bin, 'lsof'), 0o755);
  chmodSync(join(bin, 'docker'), 0o755);
  return bin;
}
const withTools = (bin, env = {}) => ({
  PATH: `${bin}:${process.env.PATH}`,
  ...env,
});

describe('ports.mjs table', () => {
  it('shows the block, each holder and whose it is', () => {
    const { home, first, second } = repoWithWorktrees();
    const bin = fakeTools({
      listeners: [
        { pid: process.pid, command: 'node', port: 4300 },
        { pid: process.ppid, command: 'node', port: 8081 },
      ],
      cwds: { [process.pid]: first, [process.ppid]: '/somewhere/else' },
      containers: [
        `${basename(second)}-postgres-test-1\t0.0.0.0:4312->5432/tcp\t${basename(second)}\t${second}\t${second}/docker-compose.test.yml`,
      ],
    });
    const { status, stdout } = ports(
      first,
      home,
      ['table'],
      withTools(bin, { ESIGN_PORT_BASE: '4300' }),
    );
    expect(status).toBe(0);
    expect(stdout).toContain(`port block 4300 (environment) - ${first}`);
    expect(stdout).toContain(
      `api           4300   node (pid ${process.pid}) [this worktree]`,
    );
    expect(stdout).toContain('webProxy      4301   -');
    expect(stdout).toContain(
      `testDb        4312   ${basename(second)}-postgres-test-1 (compose ${basename(second)}) [worktree ${basename(second)}]`,
    );
    expect(stdout).toContain(
      `metro         8081   node (pid ${process.ppid}) [foreign]`,
    );
  });

  it('names .env.local as the source once the claim is in effect', () => {
    const { home, first } = repoWithWorktrees();
    const base = ports(first, home, ['claim']).stdout.trim();
    const bin = fakeTools({});
    const { stdout } = ports(
      first,
      home,
      ['table'],
      withTools(bin, { ESIGN_PORT_BASE: base }),
    );
    expect(stdout).toContain(`port block ${base} (.env.local)`);
    expect(ports(first, home, ['table'], withTools(bin)).stdout).toContain(
      'port block 4100 (default)',
    );
  });
});

// A real listener on a port of the block, started from a directory, so
// `free` has something to stop through the real kill; a fake docker keeps
// compose out of it. The block is far from the defaults (4700). The
// listener is orphaned on purpose (a child of this worker would linger as a
// zombie while the worker sits in spawnSync, and the pid-aware fake lsof
// would keep reporting it). A run of `free` gathers twice (git, lsof, node
// start-up), hence the longer budget.
const listenerIn = async (cwd, port) => {
  const script = `require('net').createServer().listen(${port}, '127.0.0.1')`;
  const { stdout } = spawnSync(
    'bash',
    [
      '-c',
      `nohup "${process.execPath}" -e "${script}" > /dev/null 2>&1 & echo $!`,
    ],
    { cwd, encoding: 'utf8' },
  );
  const pid = Number(stdout.trim());
  for (let i = 0; i < 40 && !(await listening(port)); i += 1) {
    await new Promise(r => setTimeout(r, 50));
  }
  return {
    pid,
    kill: signal => spawnSync('kill', [`-${signal}`, String(pid)]),
  };
};
const listening = port =>
  new Promise(done => {
    const socket = connect({ port, host: '127.0.0.1' });
    socket.once('connect', () => {
      socket.destroy();
      done(true);
    });
    socket.once('error', () => done(false));
  });
const stillAlive = pid => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
const settled = async ({ pid }) => {
  for (let i = 0; i < 40 && stillAlive(pid); i += 1) {
    await new Promise(r => setTimeout(r, 50));
  }
};

describe('ports.mjs free', () => {
  it("stops this worktree's listener and its compose project, exit 0", async () => {
    const { home, first } = repoWithWorktrees();
    const server = await listenerIn(first, 4700);
    try {
      const bin = fakeTools({
        listeners: [{ pid: server.pid, command: 'node', port: 4700 }],
        cwds: { [server.pid]: first },
        containers: [
          `${basename(first)}-postgres-test-1\t0.0.0.0:4712->5432/tcp\t${basename(first)}\t${first}\t${first}/docker-compose.test.yml`,
        ],
      });
      const { status, stdout } = ports(
        first,
        home,
        ['free'],
        withTools(bin, { ESIGN_PORT_BASE: '4700' }),
      );
      expect(stdout).toContain(`stopping node (pid ${server.pid})`);
      expect(stdout).toContain(`stopping ${basename(first)}-postgres-test-1`);
      expect(readFileSync(join(bin, 'docker-calls'), 'utf8')).toContain(
        `compose -p ${basename(first)} -f ${first}/docker-compose.test.yml down`,
      );
      await settled(server);
      expect(stillAlive(server.pid)).toBe(false);
      expect(status).toBe(0);
      expect(stdout).toContain('api           4700   -');
    } finally {
      server.kill('KILL');
    }
  }, 20_000);

  it('leaves a foreign listener alone and exits 1, names FORCE=1 for a sibling worktree', async () => {
    const { home, first, second } = repoWithWorktrees();
    const foreign = await listenerIn(tempDir(), 4701);
    const sibling = await listenerIn(second, 4702);
    try {
      const bin = fakeTools({
        listeners: [
          { pid: foreign.pid, command: 'node', port: 4701 },
          { pid: sibling.pid, command: 'node', port: 4702 },
        ],
        cwds: { [foreign.pid]: '/elsewhere', [sibling.pid]: second },
      });
      const { status, stdout } = ports(
        first,
        home,
        ['free'],
        withTools(bin, { ESIGN_PORT_BASE: '4700' }),
      );
      expect(status).toBe(1);
      expect(stdout).toContain(
        `left webProxy :4701 to node (pid ${foreign.pid}): not this repo - stop it yourself`,
      );
      expect(stdout).toContain(
        `left webWebform :4702 to node (pid ${sibling.pid}): worktree ${basename(second)} - FORCE=1 stops it`,
      );
      expect(stillAlive(foreign.pid)).toBe(true);
      expect(stillAlive(sibling.pid)).toBe(true);

      const forced = ports(
        first,
        home,
        ['free', '--force'],
        withTools(bin, { ESIGN_PORT_BASE: '4700' }),
      );
      expect(forced.stdout).toContain(`stopping node (pid ${sibling.pid})`);
      await settled(sibling);
      expect(stillAlive(sibling.pid)).toBe(false);
      expect(stillAlive(foreign.pid)).toBe(true);
    } finally {
      foreign.kill('KILL');
      sibling.kill('KILL');
    }
  }, 20_000);
});
