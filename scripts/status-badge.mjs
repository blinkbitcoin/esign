// Renders a pass/fail status badge for a CI job group (Unit, E2E) from the
// job result GitHub hands to a dependent job (`needs.<job>.result`), so the
// README can show "Unit: passing" / "E2E: failing" for a branch the same way
// it shows measured coverage. Written to coverage/badge/<name>.{svg,json}
// next to the coverage badge; the `status-badges` job in ci.yml publishes
// the directory to gh-pages/badges/<branch>/.
//
//   node scripts/status-badge.mjs <name> <label> <result>
//   e.g. node scripts/status-badge.mjs unit Unit success
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { STATUS_RESULTS, renderBadgeSvg } from './lib/badge.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(root, 'coverage', 'badge');

const [name, label, result] = process.argv.slice(2);
if (!name || !label || !(result in STATUS_RESULTS)) {
  console.error(
    `status-badge: usage: status-badge.mjs <name> <label> <${Object.keys(STATUS_RESULTS).join('|')}>`,
  );
  process.exit(1);
}
if (!/^[a-z0-9-]+$/.test(name)) {
  console.error(`status-badge: name must be a file-safe slug, got "${name}"`);
  process.exit(1);
}

const { message, color } = STATUS_RESULTS[result];
mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(
  join(OUT_DIR, `${name}.svg`),
  renderBadgeSvg({ label, message, color }),
);
writeFileSync(
  join(OUT_DIR, `${name}.json`),
  `${JSON.stringify({ schemaVersion: 1, label, message, color }, null, 2)}\n`,
);
console.log(`status-badge: ${label}: ${message} -> coverage/badge/${name}.svg`);
