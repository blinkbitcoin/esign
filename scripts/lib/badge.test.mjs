import { describe, expect, it } from 'vitest';
import {
  BadgeError,
  PLACEHOLDERS,
  STATUS_RESULTS,
  WORKSPACES,
  aggregate,
  colorFor,
  escapeHtml,
  formatPercent,
  metricCell,
  parseStatus,
  renderBadgeSvg,
  renderReportHtml,
} from './badge.mjs';

describe('colorFor', () => {
  it.each([
    [100, 'brightgreen'],
    [99.9, 'green'],
    [90, 'green'],
    [89.9, 'yellowgreen'],
    [80, 'yellowgreen'],
    [79.9, 'yellow'],
    [70, 'yellow'],
    [69.9, 'red'],
    [0, 'red'],
  ])('maps %j%% to %s', (pct, color) => {
    expect(colorFor(pct)).toBe(color);
  });
});

describe('formatPercent', () => {
  it('drops a trailing .0', () => {
    expect(formatPercent(100)).toBe('100%');
  });

  it('keeps one decimal place otherwise', () => {
    expect(formatPercent(93.456)).toBe('93.5%');
  });

  it('rounds down when the second decimal is below 5', () => {
    expect(formatPercent(93.44)).toBe('93.4%');
  });

  it('formats 0 without a decimal', () => {
    expect(formatPercent(0)).toBe('0%');
  });
});

describe('parseStatus', () => {
  it('returns null when --status is absent', () => {
    expect(parseStatus([])).toBeNull();
  });

  it('accepts "failing"', () => {
    expect(parseStatus(['--status', 'failing'])).toBe('failing');
  });

  it('accepts "pending"', () => {
    expect(parseStatus(['--status', 'pending'])).toBe('pending');
  });

  it('throws a BadgeError on an unknown value', () => {
    expect(() => parseStatus(['--status', 'bogus'])).toThrowError(
      new BadgeError(
        `coverage-badge: --status must be one of ${Object.keys(PLACEHOLDERS).join(', ')}`,
      ),
    );
  });

  it('throws a BadgeError when --status has no value', () => {
    expect(() => parseStatus(['--status'])).toThrowError(BadgeError);
  });
});

describe('aggregate', () => {
  it('weights coverage by lines across workspaces', () => {
    const result = aggregate([
      {
        ws: 'packages/a',
        reportDir: 'coverage/lcov-report',
        summary: {
          lines: { covered: 90, total: 100, pct: 90 },
          statements: { covered: 90, total: 100, pct: 90 },
          branches: { covered: 90, total: 100, pct: 90 },
          functions: { covered: 90, total: 100, pct: 90 },
        },
      },
      {
        ws: 'examples/full-service-demo',
        reportDir: 'coverage',
        summary: {
          lines: { covered: 10, total: 10, pct: 100 },
          statements: { covered: 10, total: 10, pct: 100 },
          branches: { covered: 10, total: 10, pct: 100 },
          functions: { covered: 10, total: 10, pct: 100 },
        },
      },
    ]);
    expect(result.detail).toBe('100/110 lines');
    expect(result.message).toBe('90.9%');
    expect(result.color).toBe('green');
    expect(result.rows).toEqual([
      {
        ws: 'packages/a',
        reportDir: 'coverage/lcov-report',
        lines: { covered: 90, total: 100, pct: 90 },
        statements: { covered: 90, total: 100, pct: 90 },
        branches: { covered: 90, total: 100, pct: 90 },
        functions: { covered: 90, total: 100, pct: 90 },
      },
      {
        ws: 'examples/full-service-demo',
        reportDir: 'coverage',
        lines: { covered: 10, total: 10, pct: 100 },
        statements: { covered: 10, total: 10, pct: 100 },
        branches: { covered: 10, total: 10, pct: 100 },
        functions: { covered: 10, total: 10, pct: 100 },
      },
    ]);
  });

  it('tolerates a zero-total workspace as long as another has lines', () => {
    const result = aggregate([
      {
        ws: 'examples/empty-ws',
        reportDir: 'coverage',
        summary: {
          lines: { covered: 0, total: 0, pct: 100 },
          statements: { covered: 0, total: 0, pct: 100 },
          branches: { covered: 0, total: 0, pct: 100 },
          functions: { covered: 0, total: 0, pct: 100 },
        },
      },
      {
        ws: 'examples/full-service-demo',
        reportDir: 'coverage',
        summary: {
          lines: { covered: 5, total: 5, pct: 100 },
          statements: { covered: 5, total: 5, pct: 100 },
          branches: { covered: 5, total: 5, pct: 100 },
          functions: { covered: 5, total: 5, pct: 100 },
        },
      },
    ]);
    expect(result.detail).toBe('5/5 lines');
    expect(result.message).toBe('100%');
  });

  it('refuses to render when no lines were measured at all', () => {
    expect(() =>
      aggregate([
        {
          ws: 'examples/empty-ws',
          reportDir: 'coverage',
          summary: {
            lines: { covered: 0, total: 0, pct: 100 },
            statements: { covered: 0, total: 0, pct: 100 },
            branches: { covered: 0, total: 0, pct: 100 },
            functions: { covered: 0, total: 0, pct: 100 },
          },
        },
      ]),
    ).toThrowError(
      new BadgeError(
        'coverage-badge: no lines measured at all - refusing to render',
      ),
    );
  });
});

describe('renderBadgeSvg', () => {
  it('renders label, message and color', () => {
    const svg = renderBadgeSvg({
      label: 'Coverage',
      message: '93.5%',
      color: 'green',
    });
    expect(svg).toContain('Coverage');
    expect(svg).toContain('93.5%');
    expect(svg).toContain('#67ac09'); // badge-maker's "green"
  });

  it('escapes &<>" in the label and message', () => {
    const svg = renderBadgeSvg({
      label: 'a&b<c>d"e',
      message: 'x&y<z>w"v',
      color: 'red',
    });
    expect(svg).toContain('a&amp;b&lt;c&gt;d&quot;e');
    expect(svg).toContain('x&amp;y&lt;z&gt;w&quot;v');
    expect(svg).not.toContain('a&b<c>d"e');
    expect(svg).not.toContain('x&y<z>w"v');
  });
});

describe('escapeHtml', () => {
  it('escapes &<>"', () => {
    expect(escapeHtml('&<>"')).toBe('&#38;&#60;&#62;&#34;');
  });

  it('leaves other characters untouched', () => {
    expect(escapeHtml("plain text 123 'quoted'")).toBe(
      "plain text 123 'quoted'",
    );
  });

  it('stringifies non-string input', () => {
    expect(escapeHtml(42)).toBe('42');
  });
});

describe('metricCell', () => {
  it('renders percent and covered/total cells', () => {
    expect(metricCell({ pct: 93.5, covered: 187, total: 200 })).toBe(
      '<td class="n">93.5%</td><td class="n muted">187/200</td>',
    );
  });
});

describe('renderReportHtml', () => {
  it('includes a row per workspace with escaped links and metrics', () => {
    const html = renderReportHtml({
      message: '95%',
      detail: '190/200 lines',
      branch: 'main',
      sha: 'abc1234',
      rows: [
        {
          ws: 'packages/esign-core',
          lines: { covered: 100, total: 100, pct: 100 },
          statements: { covered: 100, total: 100, pct: 100 },
          branches: { covered: 100, total: 100, pct: 100 },
          functions: { covered: 100, total: 100, pct: 100 },
        },
        {
          ws: 'examples/full-service-demo',
          lines: { covered: 90, total: 100, pct: 90 },
          statements: { covered: 90, total: 100, pct: 90 },
          branches: { covered: 90, total: 100, pct: 90 },
          functions: { covered: 90, total: 100, pct: 90 },
        },
      ],
    });
    expect(html).toContain('<title>esign coverage 95%</title>');
    expect(html).toContain('190/200 lines - main @ abc1234');
    expect(html).toContain(
      '<tr><td><a href="packages/esign-core/index.html">packages/esign-core</a></td>' +
        '<td class="n">100%</td><td class="n muted">100/100</td>'.repeat(1) +
        '<td class="n">100%</td><td class="n muted">100/100</td>' +
        '<td class="n">100%</td><td class="n muted">100/100</td>' +
        '<td class="n">100%</td><td class="n muted">100/100</td></tr>',
    );
    expect(html).toContain(
      '<tr><td><a href="examples/full-service-demo/index.html">examples/full-service-demo</a></td>',
    );
  });

  it('escapes &<>" in message, detail, branch and sha', () => {
    const html = renderReportHtml({
      message: '9<5>%',
      detail: '1&0"0',
      branch: 'feat/<x>',
      sha: 'a"b',
      rows: [],
    });
    expect(html).toContain('9&#60;5&#62;%');
    expect(html).toContain('1&#38;0&#34;0');
    expect(html).toContain('feat/&#60;x&#62;');
    expect(html).toContain('a&#34;b');
  });
});

describe('WORKSPACES', () => {
  it('gives every workspace a ws and reportDir', () => {
    expect(WORKSPACES.length).toBeGreaterThan(0);
    for (const entry of WORKSPACES) {
      expect(entry).toHaveProperty('ws');
      expect(entry).toHaveProperty('reportDir');
    }
  });

  it('covers the four publishable packages plus the server examples and tooling', () => {
    expect(WORKSPACES.map(({ ws }) => ws)).toEqual([
      'packages/esign-core',
      'packages/esign-server',
      'packages/esign-react-native',
      'packages/esign-react',
      'examples/full-service-demo',
      'examples/mint-only-demo',
      'examples/serverless-handler-demo',
      'scripts',
    ]);
  });
});

describe('PLACEHOLDERS', () => {
  it('has failing and pending', () => {
    expect(Object.keys(PLACEHOLDERS).sort()).toEqual(['failing', 'pending']);
  });
});

describe('STATUS_RESULTS', () => {
  it('has success, failure, cancelled and skipped', () => {
    expect(Object.keys(STATUS_RESULTS).sort()).toEqual([
      'cancelled',
      'failure',
      'skipped',
      'success',
    ]);
  });

  it.each(Object.entries(STATUS_RESULTS))(
    '%s has a message and color',
    (_result, { message, color }) => {
      expect(typeof message).toBe('string');
      expect(typeof color).toBe('string');
    },
  );
});
