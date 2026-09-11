#!/usr/bin/env node
// CLI over scripts/lib/ports.mjs and port-holders.mjs (the pure parts are
// tested there; this file is the I/O: git, lsof, docker, the file system):
//   node scripts/e2e/ports.mjs env     shell `export` lines for every port
//   node scripts/e2e/ports.mjs <key>   one port (api, webProxy, mint, testDb, ...)
//   node scripts/e2e/ports.mjs claim   this checkout's port base: the variable
//          when set; the default for the main clone and CI; for a linked
//          worktree the block claimed in its .env.local, claimed now (the
//          lowest block no sibling worktree holds) when there is none yet
//   node scripts/e2e/ports.mjs table   the block and who holds each port (make ports)
//   node scripts/e2e/ports.mjs free [--force]
//          stop this worktree's holders - processes and compose projects -
//          then show the table; exit 1 while one of the block's ports is
//          still held. --force also stops a sibling worktree's leftovers;
//          a foreign holder is never touched (make ports-free)
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  freePlan,
  holders,
  parseCwds,
  parseDockerPs,
  parseLsofListeners,
  renderPorts,
} from '../lib/port-holders.mjs';
import {
  BASE_DEFAULT,
  BASE_VAR,
  SERVICES,
  claimedBase,
  envLines,
  nextFreeBase,
  parseWorktrees,
  resolvePorts,
  withClaimedBase,
} from '../lib/ports.mjs';

const run = (cmd, args) =>
  execFileSync(cmd, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });
// A tool's output, or nothing when it is absent or lists nothing (lsof exits 1 then)
const output = (cmd, args) => {
  try {
    return run(cmd, args);
  } catch (error) {
    return typeof error.stdout === 'string' ? error.stdout : '';
  }
};
const git = (...args) => run('git', args).trim();
const envLocalOf = dir => join(dir, '.env.local');
const readOr = (file, fallback) =>
  existsSync(file) ? readFileSync(file, 'utf8') : fallback;

// This checkout: its top directory, whether it is a linked worktree, its
// siblings (asked of git once per run)
let checkoutCache;
const checkout = () => {
  if (checkoutCache) {
    return checkoutCache;
  }
  checkoutCache = lookupCheckout();
  return checkoutCache;
};
const lookupCheckout = () => {
  try {
    const top = git('rev-parse', '--show-toplevel');
    const linked =
      resolve(git('rev-parse', '--git-dir')) !==
      resolve(git('rev-parse', '--git-common-dir'));
    // Real paths throughout: lsof reports a process's cwd resolved, git's
    // toplevel is resolved, a registered worktree path may not be
    const worktrees = parseWorktrees(
      git('worktree', 'list', '--porcelain'),
    ).map(w => ({
      ...w,
      path: existsSync(w.path) ? realpathSync(w.path) : w.path,
    }));
    return { top, linked, worktrees };
  } catch {
    return { top: process.cwd(), linked: false, worktrees: [] }; // not a git checkout (an exported tree)
  }
};

const claim = () => {
  if (process.env[BASE_VAR]) {
    return process.env[BASE_VAR];
  }
  const { top, linked, worktrees } = checkout();
  if (!linked) {
    return BASE_DEFAULT;
  }
  const own = readOr(envLocalOf(top), '');
  const claimed = claimedBase(own);
  if (claimed !== undefined) {
    return claimed;
  }
  const siblings = worktrees
    .filter(({ path }) => resolve(path) !== resolve(top))
    .map(({ path }) => claimedBase(readOr(envLocalOf(path), '')))
    .filter(base => base !== undefined);
  const base = nextFreeBase(siblings);
  writeFileSync(envLocalOf(top), withClaimedBase(own, base));
  return base;
};

// Where the base in effect came from, for the table's first line
const baseSource = top => {
  const inFile = claimedBase(readOr(envLocalOf(top), ''));
  const inEnv = process.env[BASE_VAR];
  if (inEnv && inFile !== undefined && String(inFile) === inEnv) {
    return '.env.local';
  }
  return inEnv ? 'environment' : 'default';
};

const DOCKER_FORMAT =
  '{{.Names}}\t{{.Ports}}\t{{.Label "com.docker.compose.project"}}\t{{.Label "com.docker.compose.project.working_dir"}}\t{{.Label "com.docker.compose.project.config_files"}}';

const gather = () => {
  const { top, worktrees } = checkout();
  const ports = resolvePorts(process.env);
  const listeners = parseLsofListeners(
    output('lsof', ['-nP', '-iTCP', '-sTCP:LISTEN', '-F', 'pcn']),
  );
  const wanted = new Set([...Object.values(ports), 8081]);
  const pids = [
    ...new Set(listeners.filter(l => wanted.has(l.port)).map(l => l.pid)),
  ];
  const cwds = parseCwds(
    pids.length > 0
      ? output('lsof', ['-a', '-p', pids.join(','), '-d', 'cwd', '-F', 'pn'])
      : '',
  );
  const containers = parseDockerPs(
    output('docker', ['ps', '--format', DOCKER_FORMAT]),
  );
  const rows = holders({
    ports,
    listeners,
    cwds,
    containers,
    worktrees,
    self: top,
  });
  return { top, ports, rows };
};

const table = () => {
  const { top, ports, rows } = gather();
  console.log(
    renderPorts(rows, {
      base: ports.base,
      source: baseSource(top),
      self: top,
    }).join('\n'),
  );
  return 0;
};

const sleep = ms =>
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const alive = pid => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

const free = force => {
  const { rows } = gather();
  const { stop, keep } = freePlan(rows, { force });
  for (const action of stop) {
    if (action.kind === 'kill') {
      console.log(`stopping ${action.label}`);
      try {
        process.kill(action.pid, 'SIGTERM');
      } catch {
        // already gone
      }
    } else {
      console.log(`stopping ${action.label}`);
      const files = action.configFiles ? ['-f', action.configFiles] : [];
      output('docker', [
        'compose',
        '-p',
        action.project || action.label,
        ...files,
        'down',
      ]);
    }
  }
  const killed = stop.filter(a => a.kind === 'kill');
  for (let i = 0; i < 10 && killed.some(a => alive(a.pid)); i += 1) {
    sleep(500);
  }
  for (const action of killed.filter(a => alive(a.pid))) {
    console.log(`${action.label} ignored SIGTERM - SIGKILL`);
    try {
      process.kill(action.pid, 'SIGKILL');
    } catch {
      // gone between the check and the kill
    }
  }
  for (const { service, port, label, reason } of keep) {
    console.log(`left ${service} :${port} to ${label}: ${reason}`);
  }
  const after = gather();
  console.log(
    renderPorts(after.rows, {
      base: after.ports.base,
      source: baseSource(after.top),
      self: after.top,
    }).join('\n'),
  );
  return after.rows.some(r => !r.global && r.holder) ? 1 : 0;
};

const [what = 'env', ...rest] = process.argv.slice(2);
if (what === 'env') {
  console.log(envLines(process.env).join('\n'));
} else if (what === 'claim') {
  console.log(claim());
} else if (what === 'table') {
  process.exitCode = table();
} else if (what === 'free') {
  process.exitCode = free(rest.includes('--force'));
} else if (what in SERVICES) {
  console.log(resolvePorts(process.env)[what]);
} else {
  console.error(
    `usage: ports.mjs env | claim | table | free [--force] | ${Object.keys(SERVICES).join(' | ')}`,
  );
  process.exit(2);
}
