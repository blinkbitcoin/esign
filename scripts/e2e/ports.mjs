#!/usr/bin/env node
// CLI over scripts/lib/ports.mjs (the pure part is tested there):
//   node scripts/e2e/ports.mjs env     shell `export` lines for every port
//   node scripts/e2e/ports.mjs <key>   one port (api, webProxy, mint, ...)
import { SERVICES, envLines, resolvePorts } from '../lib/ports.mjs';

const [what = 'env'] = process.argv.slice(2);
if (what === 'env') {
  console.log(envLines(process.env).join('\n'));
} else if (what in SERVICES) {
  console.log(resolvePorts(process.env)[what]);
} else {
  console.error(`usage: ports.mjs env | ${Object.keys(SERVICES).join(' | ')}`);
  process.exit(2);
}
