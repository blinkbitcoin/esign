// Pure logic shared by scripts/coverage-badge.mjs and scripts/status-badge.mjs
// (the CLIs wrap this with file reads/writes, env reads and process.exit).
// Kept here so the arithmetic, thresholds and templating are unit tested
// without touching the filesystem or badge-maker's actual rendering path.
import { makeBadge } from 'badge-maker';

export class BadgeError extends Error {}

// Single source of truth for "what the coverage badge measures". reportDir is
// where each runner writes its HTML report relative to `<ws>/coverage`:
// Vitest (examples/full-service-demo, scripts) uses the html reporter's own `coverage/` root;
// Jest uses the lcov reporter's `coverage/lcov-report`.
export const WORKSPACES = [
  { ws: 'packages/esign-core', reportDir: 'coverage/lcov-report' },
  { ws: 'packages/esign-server', reportDir: 'coverage/lcov-report' },
  { ws: 'packages/esign-react-native', reportDir: 'coverage/lcov-report' },
  { ws: 'packages/esign-react', reportDir: 'coverage/lcov-report' },
  { ws: 'examples/full-service-demo', reportDir: 'coverage' },
  { ws: 'scripts', reportDir: 'coverage' },
];

export const PLACEHOLDERS = { failing: 'red', pending: 'yellow' };

// GitHub job results -> badge text/color. Anything else (a typo, a future
// result value) is an error rather than a silently green badge.
export const STATUS_RESULTS = {
  success: { message: 'passing', color: 'brightgreen' },
  failure: { message: 'failing', color: 'red' },
  cancelled: { message: 'cancelled', color: 'lightgrey' },
  skipped: { message: 'skipped', color: 'lightgrey' },
};

export function colorFor(pct) {
  if (pct >= 100) return 'brightgreen';
  if (pct >= 90) return 'green';
  if (pct >= 80) return 'yellowgreen';
  if (pct >= 70) return 'yellow';
  return 'red';
}

export function formatPercent(pct) {
  const fixed = pct.toFixed(1);
  return `${fixed.endsWith('.0') ? fixed.slice(0, -2) : fixed}%`;
}

// argv -> the requested placeholder status, or null when `--status` is
// absent. Throws BadgeError (message identical to the old script's
// console.error) on an unrecognized value; the CLI prints it and exits 1.
export function parseStatus(argv) {
  const i = argv.indexOf('--status');
  if (i === -1) return null;
  const status = argv[i + 1];
  if (!(status in PLACEHOLDERS)) {
    throw new BadgeError(
      `coverage-badge: --status must be one of ${Object.keys(PLACEHOLDERS).join(', ')}`,
    );
  }
  return status;
}

// The arithmetic of the old measure(): weights each workspace's line
// coverage into one aggregate percentage. `summaries` is
// `[{ ws, reportDir, summary }]` where `summary` is the `total` object from
// a workspace's coverage-summary.json (lines/statements/branches/functions,
// each `{ covered, total, pct, skipped }`). Throws BadgeError when no lines
// were measured at all, matching the old script's refusal to render.
export function aggregate(summaries) {
  let covered = 0;
  let total = 0;
  const rows = [];
  for (const { ws, reportDir, summary } of summaries) {
    covered += summary.lines.covered;
    total += summary.lines.total;
    rows.push({ ws, reportDir, ...summary });
  }
  if (total === 0) {
    throw new BadgeError(
      'coverage-badge: no lines measured at all - refusing to render',
    );
  }
  const pct = (covered / total) * 100;
  return {
    message: formatPercent(pct),
    color: colorFor(pct),
    detail: `${covered}/${total} lines`,
    rows,
  };
}

// The one shields-identical flat badge renderer both CLIs use.
export function renderBadgeSvg({ label, message, color }) {
  return makeBadge({ label, message, color, style: 'flat' });
}

export function escapeHtml(v) {
  return String(v).replace(/[&<>"]/g, c => `&#${c.charCodeAt(0)};`);
}

export function metricCell(m) {
  return `<td class="n">${m.pct}%</td><td class="n muted">${m.covered}/${m.total}</td>`;
}

// One index page for the coverage report: a table of per-workspace numbers
// linking to each workspace's own HTML report (copied alongside by the CLI).
export function renderReportHtml({ message, detail, branch, sha, rows }) {
  const body = rows
    .map(
      ({ ws, lines, statements, branches, functions }) =>
        `<tr><td><a href="${escapeHtml(ws)}/index.html">${escapeHtml(ws)}</a></td>${metricCell(lines)}${metricCell(statements)}${metricCell(branches)}${metricCell(functions)}</tr>`,
    )
    .join('\n');
  return `<!doctype html><meta charset="utf-8"><title>esign coverage ${escapeHtml(message)}</title>
<style>body{font:14px/1.5 system-ui,sans-serif;margin:2rem auto;max-width:60rem;padding:0 1rem}table{border-collapse:collapse;width:100%}th,td{padding:.4rem .6rem;border-bottom:1px solid #ddd;text-align:left}th.n,td.n{text-align:right}.muted{color:#777}h1 small{font-weight:normal;color:#777}</style>
<h1>Coverage ${escapeHtml(message)} <small>${escapeHtml(detail)} - ${escapeHtml(branch)} @ ${escapeHtml(sha)}</small></h1>
<p>Line coverage aggregated over the workspaces that enforce 100% (the four publishable packages, the backend, and the tooling scripts). Demo apps are excluded. Click a workspace for its file-level report.</p>
<table><thead><tr><th>Workspace</th><th class="n" colspan="2">Lines</th><th class="n" colspan="2">Statements</th><th class="n" colspan="2">Branches</th><th class="n" colspan="2">Functions</th></tr></thead>
<tbody>${body}</tbody></table>
`;
}
