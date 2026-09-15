#!/usr/bin/env node
// Classifies the change so ci.yml can stop after Checks when only
// documentation moved (scripts/lib/docs-only.mjs holds the rule and its
// table test). Every event goes through here - a PR and its merge to main
// get the same answer.
// Env: EVENT_NAME (github.event_name), BASE_SHA (PR base), BEFORE
// (github.event.before, push). Output: docs-only=true|false to
// $GITHUB_OUTPUT and stdout. CI: the Changes job in checks.yml.

import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';

import { diffRange, isDocsOnly } from '../lib/docs-only.mjs';

const emit = value => {
  const line = `docs-only=${value}\n`;
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, line);
  }
  process.stdout.write(line);
};

const range = diffRange(process.env.EVENT_NAME, {
  before: process.env.BEFORE,
  baseSha: process.env.BASE_SHA,
});

if (!range) {
  emit(false);
  process.exit(0);
}

// A force-push can leave `before` unreachable, and a shallow clone can leave
// it absent. Either way the change cannot be classified, so run everything -
// never treat an unreadable diff as "nothing but docs".
let files;
try {
  files = execFileSync('git', ['diff', '--name-only', range], {
    encoding: 'utf8',
    // Capture git's stderr rather than letting it through: the catch below
    // reports it once, under a notice that says what happens next.
    stdio: ['ignore', 'pipe', 'pipe'],
  })
    .split('\n')
    .filter(Boolean);
} catch (error) {
  console.log(`::notice::cannot diff ${range} - running everything`);
  console.log(String(error.stderr || error.message).trim());
  emit(false);
  process.exit(0);
}

emit(isDocsOnly(files));
console.log(`changed files:\n${files.join('\n')}`);
