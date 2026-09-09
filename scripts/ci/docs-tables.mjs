#!/usr/bin/env node
// Fails when a markdown table cell has a line wider than the house limit
// (scripts/lib/table-lines.mjs): on GitHub such a cell squeezes the other
// columns until their code spans wrap word by word. Break long cells with
// <br>. Scope: the READMEs GitHub shows on the repo and package pages.
//   node scripts/ci/docs-tables.mjs [files...]   (default: every README.md)
// CI: Checks / Docs (make docs-check).
import { globSync, readFileSync } from 'node:fs';
import { formatFindings, overlongTableLines } from '../lib/table-lines.mjs';

const files =
  process.argv.length > 2
    ? process.argv.slice(2)
    : globSync(['README.md', 'packages/*/README.md', 'examples/*/README.md'], {
        exclude: name => name.includes('node_modules'),
      });
let problems = 0;
for (const file of files) {
  const findings = overlongTableLines(readFileSync(file, 'utf8'));
  for (const line of formatFindings(file, findings)) {
    console.log(`::error::${line}`);
    problems++;
  }
}
if (problems) {
  console.log(`docs tables: ${problems} over-wide table line(s)`);
  process.exit(1);
}
console.log(`docs tables: ok (${files.length} files)`);
