// Renders the README coverage badge from measured numbers instead of a
// hardcoded shields.io URL. Aggregates line coverage across the workspaces
// that enforce 100% (the four publishable packages, the backend, and the
// tooling scripts) by reading the `json-summary` reporter output each of
// them emits under
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
//
// The measuring/rendering arithmetic and HTML templating are pure functions
// in ./lib/badge.mjs (unit tested there); this file is only file I/O, env
// reads and process exit codes.
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
import {
  BadgeError,
  PLACEHOLDERS,
  WORKSPACES,
  aggregate,
  parseStatus,
  renderBadgeSvg,
  renderReportHtml,
} from './lib/badge.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const BADGE_DIR = join(root, 'coverage', 'badge');
const REPORT_DIR = join(root, 'coverage', 'report');

function htmlReportDir({ ws, reportDir }) {
  return join(root, ws, reportDir);
}

function measure() {
  const summaries = [];
  for (const { ws, reportDir } of WORKSPACES) {
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
    summaries.push({ ws, reportDir, summary: t });
  }
  return aggregate(summaries);
}

// One index page + a copy of every workspace's own HTML report beneath it.
function writeReport({ message, detail, rows }) {
  rmSync(REPORT_DIR, { recursive: true, force: true });
  mkdirSync(REPORT_DIR, { recursive: true });
  for (const { ws, reportDir } of rows) {
    const src = htmlReportDir({ ws, reportDir });
    if (!existsSync(join(src, 'index.html'))) {
      console.error(
        `coverage-badge: no HTML report at ${src} - check the workspace's coverage reporters`,
      );
      process.exit(1);
    }
    cpSync(src, join(REPORT_DIR, ws), { recursive: true });
  }
  const sha = process.env.GITHUB_SHA
    ? process.env.GITHUB_SHA.slice(0, 7)
    : 'local';
  const branch =
    process.env.GITHUB_HEAD_REF || process.env.GITHUB_REF_NAME || 'local';
  writeFileSync(
    join(REPORT_DIR, 'index.html'),
    renderReportHtml({ message, detail, branch, sha, rows }),
  );
}

let status;
let result;
try {
  status = parseStatus(process.argv.slice(2));
  result = status
    ? { message: status, color: PLACEHOLDERS[status], detail: 'placeholder' }
    : measure();
} catch (err) {
  if (err instanceof BadgeError) {
    console.error(err.message);
    process.exit(1);
  }
  throw err;
}
const { message, color, detail } = result;

mkdirSync(BADGE_DIR, { recursive: true });
writeFileSync(
  join(BADGE_DIR, 'coverage.svg'),
  renderBadgeSvg({ label: 'Coverage', message, color }),
);
if (!status) writeReport(result);

console.log(
  `coverage-badge: ${message} (${detail}) -> coverage/badge/${status ? '' : ' + coverage/report/'}`,
);
