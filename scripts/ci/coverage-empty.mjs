#!/usr/bin/env node
// Fails when any workspace's last coverage run lists a file with nothing to
// cover (scripts/lib/coverage-empty.mjs): re-export barrels and type-only
// modules belong in that workspace's coverage exclude list, not in the
// report as 0%. Run after the coverage runs: make coverage.
import { globSync, readFileSync } from 'node:fs';
import { relative } from 'node:path';
import {
  coverageWorkspaces,
  emptyCoverageFiles,
  formatEmptyFiles,
  missingSummaries,
} from '../lib/coverage-empty.mjs';

const summaries = globSync(
  '{packages,examples,scripts}/**/coverage/coverage-summary.json',
  {
    exclude: name => name.includes('node_modules'),
  },
);
let problems = 0;
// A workspace that ran coverage but left no summary would be invisible here
const expected = coverageWorkspaces(
  JSON.parse(readFileSync('package.json', 'utf8')).scripts['test:coverage'],
);
for (const workspace of missingSummaries(expected, summaries)) {
  console.log(
    `::error::${workspace}: no coverage/coverage-summary.json - add 'json-summary' to its coverage reporters`,
  );
  problems++;
}
for (const file of summaries) {
  const workspace = file.replace(/\/coverage\/coverage-summary\.json$/, '');
  const empty = emptyCoverageFiles(JSON.parse(readFileSync(file, 'utf8'))).map(
    f => relative(process.cwd(), f),
  );
  for (const line of formatEmptyFiles(workspace, empty)) {
    console.log(`::error::${line}`);
    problems++;
  }
}
if (problems) {
  console.log(
    `coverage: ${problems} file(s) with nothing to cover - exclude them`,
  );
  process.exit(1);
}
console.log(`coverage: no empty rows (${summaries.length} workspaces)`);
