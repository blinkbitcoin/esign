#!/usr/bin/env node
// CLI over scripts/lib/codeql-findings.mjs (the pure part is tested there):
//   node scripts/codeql-findings.mjs <results.sarif>
// Prints every finding and exits 1 when one is not suppressed by an inline
// marker - what make codeql ends with.
import { readFileSync } from 'node:fs';
import { summarize } from './lib/codeql-findings.mjs';

const [file] = process.argv.slice(2);
if (!file) {
  console.error('usage: codeql-findings.mjs <results.sarif>');
  process.exit(2);
}
const { open, lines } = summarize(JSON.parse(readFileSync(file, 'utf8')));
for (const line of lines) {
  console.log(line);
}
process.exit(open > 0 ? 1 : 0);
