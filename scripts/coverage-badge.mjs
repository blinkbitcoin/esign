// Renders the README coverage badge from measured numbers instead of a
// hardcoded shields.io URL. Aggregates line coverage across the workspaces
// that enforce 100% (the three publishable packages + the backend) by
// reading the `json-summary` reporter output each of them emits under
// `<workspace>/coverage/coverage-summary.json`. The demo apps are excluded
// on purpose: they carry floors, not 100%, and their real coverage is E2E.
//
// Every listed summary MUST exist - a missing one aborts instead of silently
// inflating the number. Output goes to coverage/badge/ (gitignored):
//   coverage.svg   shields-identical flat badge (rendered by badge-maker)
//   coverage.json  shields "endpoint" schema, for a future endpoint badge
// CI (test.yml) renders on every run and publishes the result to the
// `gh-pages` branch on pushes to main; README.md embeds it from there.
import { makeBadge } from 'badge-maker';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// Single source of truth for "what the badge measures".
const WORKSPACES = [
  'packages/esign-core',
  'packages/esign-react-native',
  'packages/esign-react',
  'apps/api',
];

const OUT_DIR = join(root, 'coverage', 'badge');

function colorFor(pct) {
  if (pct >= 100) return 'brightgreen';
  if (pct >= 90) return 'green';
  if (pct >= 80) return 'yellowgreen';
  if (pct >= 70) return 'yellow';
  return 'red';
}

function formatPercent(pct) {
  const fixed = pct.toFixed(1);
  return `${fixed.endsWith('.0') ? fixed.slice(0, -2) : fixed}%`;
}

let covered = 0;
let total = 0;
for (const ws of WORKSPACES) {
  const file = join(root, ws, 'coverage', 'coverage-summary.json');
  if (!existsSync(file)) {
    console.error(
      `coverage-badge: missing ${ws}/coverage/coverage-summary.json - run \`npm run test:coverage\` first`,
    );
    process.exit(1);
  }
  const { lines } = JSON.parse(readFileSync(file, 'utf8')).total;
  console.log(`${ws}: ${lines.covered}/${lines.total} lines (${lines.pct}%)`);
  covered += lines.covered;
  total += lines.total;
}

if (total === 0) {
  console.error(
    'coverage-badge: no lines measured at all - refusing to render',
  );
  process.exit(1);
}

const pct = (covered / total) * 100;
const message = formatPercent(pct);
const color = colorFor(pct);

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(
  join(OUT_DIR, 'coverage.svg'),
  makeBadge({ label: 'coverage', message, color, style: 'flat' }),
);
writeFileSync(
  join(OUT_DIR, 'coverage.json'),
  `${JSON.stringify({ schemaVersion: 1, label: 'coverage', message, color }, null, 2)}\n`,
);

console.log(
  `coverage-badge: ${message} (${covered}/${total} lines) -> coverage/badge/`,
);
