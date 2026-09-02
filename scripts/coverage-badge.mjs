// Renders the README coverage badge from measured numbers instead of a
// hardcoded shields.io URL. Aggregates line coverage across the workspaces
// that enforce 100% (the three publishable packages + the backend) by
// reading the `json-summary` reporter output each of them emits under
// `<workspace>/coverage/coverage-summary.json`. The demo apps are excluded
// on purpose: they carry floors, not 100%, and their real coverage is E2E.
//
// Every listed summary MUST exist - a missing one aborts instead of silently
// inflating the number. Output (gitignored):
//   coverage/badge/coverage.svg  shields-identical flat badge (badge-maker)
//   coverage/report/             one HTML report: an index page with the
//                                per-workspace numbers, linking to each
//                                workspace's own istanbul/v8 HTML report
// CI (test.yml) renders both on every run, publishes the badge per branch
// to `gh-pages/badges/<branch>/` (README.md embeds main's) and uploads the
// report as the `coverage-report` run artifact - private, unlike GitHub
// Pages, which would expose the source embedded in the report.
//
// `--status failing` / `--status pending` render an honest placeholder badge
// (no report): CI publishes "failing" (red) when the coverage run did not
// produce a result, and "pending" (yellow) seeds a branch before its first
// run.
import { makeBadge } from 'badge-maker';
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
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

const BADGE_DIR = join(root, 'coverage', 'badge');
const REPORT_DIR = join(root, 'coverage', 'report');

// Where each runner writes its HTML report (jest: lcov reporter; vitest: html)
function htmlReportDir(ws) {
  return join(
    root,
    ws,
    'coverage',
    ws.startsWith('apps/') ? '' : 'lcov-report',
  );
}

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
  const rows = [];
  for (const ws of WORKSPACES) {
    const file = join(root, ws, 'coverage', 'coverage-summary.json');
    if (!existsSync(file)) {
      console.error(
        `coverage-badge: missing ${ws}/coverage/coverage-summary.json - run \`npm run test:coverage\` first`,
      );
      process.exit(1);
    }
    const { total: t } = JSON.parse(readFileSync(file, 'utf8'));
    console.log(
      `${ws}: ${t.lines.covered}/${t.lines.total} lines (${t.lines.pct}%)`,
    );
    covered += t.lines.covered;
    total += t.lines.total;
    rows.push({ ws, ...t });
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
    rows,
  };
}

const esc = v => String(v).replace(/[&<>"]/g, c => `&#${c.charCodeAt(0)};`);

function metricCell(m) {
  return `<td class="n">${m.pct}%</td><td class="n muted">${m.covered}/${m.total}</td>`;
}

// One index page + a copy of every workspace's own HTML report beneath it.
function writeReport({ message, detail, rows }) {
  rmSync(REPORT_DIR, { recursive: true, force: true });
  mkdirSync(REPORT_DIR, { recursive: true });
  const body = rows
    .map(({ ws, ...m }) => {
      const src = htmlReportDir(ws);
      if (!existsSync(join(src, 'index.html'))) {
        console.error(
          `coverage-badge: no HTML report at ${src} - check the workspace's coverage reporters`,
        );
        process.exit(1);
      }
      cpSync(src, join(REPORT_DIR, ws), { recursive: true });
      return `<tr><td><a href="${esc(ws)}/index.html">${esc(ws)}</a></td>${metricCell(m.lines)}${metricCell(m.statements)}${metricCell(m.branches)}${metricCell(m.functions)}</tr>`;
    })
    .join('\n');
  const sha = process.env.GITHUB_SHA
    ? process.env.GITHUB_SHA.slice(0, 7)
    : 'local';
  const branch =
    process.env.GITHUB_HEAD_REF || process.env.GITHUB_REF_NAME || 'local';
  writeFileSync(
    join(REPORT_DIR, 'index.html'),
    `<!doctype html><meta charset="utf-8"><title>blink-esign coverage ${esc(message)}</title>
<style>body{font:14px/1.5 system-ui,sans-serif;margin:2rem auto;max-width:60rem;padding:0 1rem}table{border-collapse:collapse;width:100%}th,td{padding:.4rem .6rem;border-bottom:1px solid #ddd;text-align:left}th.n,td.n{text-align:right}.muted{color:#777}h1 small{font-weight:normal;color:#777}</style>
<h1>Coverage ${esc(message)} <small>${esc(detail)} - ${esc(branch)} @ ${esc(sha)}</small></h1>
<p>Line coverage aggregated over the workspaces that enforce 100% (the three publishable packages and the backend). Demo apps are excluded. Click a workspace for its file-level report.</p>
<table><thead><tr><th>Workspace</th><th class="n" colspan="2">Lines</th><th class="n" colspan="2">Statements</th><th class="n" colspan="2">Branches</th><th class="n" colspan="2">Functions</th></tr></thead>
<tbody>${body}</tbody></table>
`,
  );
}

const status = parseStatus(process.argv.slice(2));
const result = status
  ? { message: status, color: PLACEHOLDERS[status], detail: 'placeholder' }
  : measure();
const { message, color, detail } = result;

mkdirSync(BADGE_DIR, { recursive: true });
writeFileSync(
  join(BADGE_DIR, 'coverage.svg'),
  makeBadge({ label: 'Coverage', message, color, style: 'flat' }),
);
if (!status) writeReport(result);

console.log(
  `coverage-badge: ${message} (${detail}) -> coverage/badge/${status ? '' : ' + coverage/report/'}`,
);
