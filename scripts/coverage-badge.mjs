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
//
// `--status failing` / `--status pending` render an honest placeholder
// instead of a number: CI publishes "failing" (red) when the coverage run on
// main did not produce a result, and "pending" (yellow) seeds the branch
// before the first run.
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

const PLACEHOLDERS = { failing: 'red', pending: 'yellow' };

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

function parseStatus(argv) {
  const i = argv.indexOf('--status');
  if (i === -1) return null;
  const status = argv[i + 1];
  if (!(status in PLACEHOLDERS)) {
    console.error(
      `coverage-badge: --status must be one of ${Object.keys(PLACEHOLDERS).join(', ')}`,
    );
    process.exit(1);
  }
  return status;
}

function measure() {
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
  return {
    message: formatPercent(pct),
    color: colorFor(pct),
    detail: `${covered}/${total} lines`,
  };
}

const status = parseStatus(process.argv.slice(2));
const { message, color, detail } = status
  ? { message: status, color: PLACEHOLDERS[status], detail: 'placeholder' }
  : measure();

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(
  join(OUT_DIR, 'coverage.svg'),
  makeBadge({ label: 'Coverage', message, color, style: 'flat' }),
);
writeFileSync(
  join(OUT_DIR, 'coverage.json'),
  `${JSON.stringify({ schemaVersion: 1, label: 'Coverage', message, color }, null, 2)}\n`,
);

console.log(`coverage-badge: ${message} (${detail}) -> coverage/badge/`);
