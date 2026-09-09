#!/usr/bin/env node
// Prints the package.json paths (from argv) whose change against <base-ref>
// is structural - anything beyond dependency ranges and the version
// (scripts/lib/manifest-structural.mjs). docs-freshness.sh feeds it the
// changed manifests so a dependency bump does not trigger the docs warning.
//   node scripts/ci/manifest-structural.mjs <base-ref> <package.json>...
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { isStructuralManifestChange } from '../lib/manifest-structural.mjs';

const [base, ...files] = process.argv.slice(2);
const readAt = (ref, file) => {
  try {
    return JSON.parse(
      execFileSync('git', ['show', `${ref}:${file}`], { encoding: 'utf8' }),
    );
  } catch {
    return undefined; // did not exist at that ref
  }
};
const readNow = file => {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return undefined; // deleted
  }
};
for (const file of files) {
  if (isStructuralManifestChange(readAt(base, file), readNow(file))) {
    console.log(file);
  }
}
