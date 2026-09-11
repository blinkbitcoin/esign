#!/usr/bin/env node
// CLI over scripts/lib/ports.mjs (the pure part is tested there; this file
// is the I/O: git, the file system, the environment):
//   node scripts/e2e/ports.mjs env     shell `export` lines for every port
//   node scripts/e2e/ports.mjs <key>   one port (api, webProxy, mint, testDb, ...)
//   node scripts/e2e/ports.mjs claim   this checkout's port base: the variable
//          when set; the default for the main clone and CI; for a linked
//          worktree the block claimed in its .env.local, claimed now (the
//          lowest block no sibling worktree holds) when there is none yet
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
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

const git = (...args) =>
  execFileSync('git', args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();
const envLocalOf = dir => join(dir, '.env.local');
const readOr = (file, fallback) =>
  existsSync(file) ? readFileSync(file, 'utf8') : fallback;

const claim = () => {
  if (process.env[BASE_VAR]) {
    return process.env[BASE_VAR];
  }
  let top;
  let linked;
  try {
    top = git('rev-parse', '--show-toplevel');
    linked =
      resolve(git('rev-parse', '--git-dir')) !==
      resolve(git('rev-parse', '--git-common-dir'));
  } catch {
    return BASE_DEFAULT; // not a git checkout (an exported tree): the default block
  }
  if (!linked) {
    return BASE_DEFAULT;
  }
  const own = readOr(envLocalOf(top), '');
  const claimed = claimedBase(own);
  if (claimed !== undefined) {
    return claimed;
  }
  const siblings = parseWorktrees(git('worktree', 'list', '--porcelain'))
    .filter(({ path }) => resolve(path) !== resolve(top))
    .map(({ path }) => claimedBase(readOr(envLocalOf(path), '')))
    .filter(base => base !== undefined);
  const base = nextFreeBase(siblings);
  writeFileSync(envLocalOf(top), withClaimedBase(own, base));
  return base;
};

const [what = 'env'] = process.argv.slice(2);
if (what === 'env') {
  console.log(envLines(process.env).join('\n'));
} else if (what === 'claim') {
  console.log(claim());
} else if (what in SERVICES) {
  console.log(resolvePorts(process.env)[what]);
} else {
  console.error(
    `usage: ports.mjs env | claim | ${Object.keys(SERVICES).join(' | ')}`,
  );
  process.exit(2);
}
