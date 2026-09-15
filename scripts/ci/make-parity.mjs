#!/usr/bin/env node
// Fails when a workflow step runs a script that a make target already wraps,
// so the Makefile stays the one definition of what CI runs and the two cannot
// drift (scripts/lib/make-parity.mjs holds the rule and its table test).
// Run by `make check-ci`, and therefore by the Checks / Code job.

import { globSync, readFileSync } from 'node:fs';

import {
  formatViolations,
  normalize,
  parityViolations,
  stepsFrom,
  targetsFrom,
} from '../lib/make-parity.mjs';

// Invocations a workflow is allowed to make directly, each with the reason.
// An exception belongs here, written down, rather than as a silent difference.
const ALLOWED = {
  // CI substitutes the packages-dist artifact for the local build, so the Web
  // job deliberately runs the Playwright project without `make e2e-web`'s
  // `build` prerequisite - calling the target would rebuild what Build
  // Packages just built and uploaded.
  [normalize('npm run test:e2e -w examples/react-demo')]:
    'the Web job builds via the packages-dist artifact, not locally',
};

const targets = targetsFrom(readFileSync('Makefile', 'utf8'));
const steps = globSync('.github/workflows/*.yml').flatMap(file =>
  stepsFrom(readFileSync(file, 'utf8'), file),
);
const violations = parityViolations(steps, targets, ALLOWED);

for (const line of formatViolations(violations)) {
  console.log(`::error::${line}`);
}

if (violations.length > 0) {
  console.log(
    `make parity: ${violations.length} workflow step(s) bypass a make target`,
  );
  process.exit(1);
}

console.log(
  `make parity: ok (${steps.length} run steps, ${Object.keys(targets).length} targets)`,
);
