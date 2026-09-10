#!/usr/bin/env node
// Decides what a CI run publishes and stamps it into the four packages.
//   release event : the tag IS the version (vX.Y.Z -> X.Y.Z, dist-tag latest;
//                   vX.Y.Z-<pre> -> dist-tag next). The commit must be on main.
//   anything else : prerelease <next-patch-after-latest-v*-tag>-pre.<run>.<sha>
//                   under dist-tag next.
// Core is pinned exactly by the platform packages (a caret range never matches
// a prerelease, and an exact pin is right for stable too).
// Env: EVENT (github.event_name), TAG (release tag), RUN (run number),
//      GITHUB_SHA. DRY_RUN=1 prints without touching package.json.
// Outputs version= and disttag= to $GITHUB_OUTPUT (stdout when unset).
// CI: E2E / Build Packages (Publish ships the tarballs it packs). Local:
// make version [TAG=vX.Y.Z]
import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ResolveVersionError,
  resolveVersion,
} from '../lib/resolve-version.mjs';
import { parseVersionTag } from '../lib/semver.mjs';
import { dependencyStamps, PUBLISHED_PACKAGES } from '../lib/workspaces.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
process.chdir(root);

const EVENT = process.env.EVENT || 'push';
const TAG = process.env.TAG || '';
const RUN = process.env.RUN || '0';
const SHA =
  process.env.GITHUB_SHA ||
  execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const OUT = process.env.GITHUB_OUTPUT;
const DRY_RUN = process.env.DRY_RUN;

function shortSha(sha) {
  return execFileSync('git', ['rev-parse', '--short', sha], {
    encoding: 'utf8',
  }).trim();
}

function isOnMain(sha) {
  try {
    execFileSync('git', ['merge-base', '--is-ancestor', sha, 'origin/main'], {
      stdio: 'ignore',
    });
    return true;
  } catch {
    return false;
  }
}

function latestTag() {
  try {
    return execFileSync(
      'git',
      ['describe', '--tags', '--abbrev=0', '--match', 'v[0-9]*'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
    ).trim();
  } catch {
    return null;
  }
}

let result;
try {
  result = resolveVersion({
    event: EVENT,
    tag: TAG,
    run: RUN,
    sha: SHA,
    shortSha: EVENT === 'release' ? undefined : shortSha(SHA),
    latestTag: EVENT === 'release' ? undefined : latestTag(),
    onMain:
      EVENT === 'release' && parseVersionTag(TAG) ? isOnMain(SHA) : undefined,
  });
} catch (err) {
  if (err instanceof ResolveVersionError) {
    console.log(err.message);
    process.exit(1);
  }
  throw err;
}

const { version: VERSION, disttag: DISTTAG } = result;

if (!DRY_RUN) {
  for (const p of PUBLISHED_PACKAGES) {
    execFileSync('npm', ['pkg', 'set', `version=${VERSION}`], {
      cwd: p,
      stdio: 'inherit',
    });
  }
  // Every workspace that depends on a published package by version follows
  // it (the examples on esign-node, the platform packages on core), or
  // `npm ci` in the service image asks the registry for the stamped version
  for (const { dir, args } of dependencyStamps(VERSION)) {
    execFileSync('npm', args, { cwd: dir, stdio: 'inherit' });
  }
}

const outputLines = `version=${VERSION}\ndisttag=${DISTTAG}\n`;
if (OUT) {
  appendFileSync(OUT, outputLines);
} else {
  process.stdout.write(outputLines);
}
console.log(
  `Publishing ${VERSION} under dist-tag ${DISTTAG}${DRY_RUN ? ' (dry run)' : ''}`,
);
