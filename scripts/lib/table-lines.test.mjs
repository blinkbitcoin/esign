import { describe, expect, it } from 'vitest';
import {
  formatFindings,
  MAX_LINE,
  overlongTableLines,
} from './table-lines.mjs';

const wide = 'x'.repeat(MAX_LINE + 1);

describe('overlongTableLines', () => {
  it('accepts a table whose every cell line fits', () => {
    const md = [
      '| Target | Purpose |',
      '|---|---|',
      '| `make test` | Unit suites + lint |',
    ].join('\n');
    expect(overlongTableLines(md)).toEqual([]);
  });

  it('flags a cell line over the limit with its position and width', () => {
    const md = ['| A | B |', '|---|---|', `| short | ${wide} |`].join('\n');
    expect(overlongTableLines(md)).toEqual([
      { line: 3, column: 2, width: MAX_LINE + 1, text: wide },
    ]);
  });

  it('measures each <br> segment on its own, so a broken line passes', () => {
    const md = ['| A | B |', '|---|---|', `| x | ${wide}<br>${wide} |`].join(
      '\n',
    );
    expect(overlongTableLines(md)).toHaveLength(2);
    const ok = [
      '| A | B |',
      '|---|---|',
      `| x | ${'y'.repeat(40)}<br/>${'z'.repeat(40)} |`,
    ].join('\n');
    expect(overlongTableLines(ok)).toEqual([]);
  });

  it('counts visible characters only: links, code, emphasis, tags and escaped pipes', () => {
    const decorated = `[\`${'a'.repeat(30)}\`](https://example.com/${'b'.repeat(80)}) **bold** <sub>x</sub> c\\|d`;
    const md = ['| A |', '|---|', `| ${decorated} |`].join('\n');
    expect(overlongTableLines(md)).toEqual([]);
    expect(overlongTableLines(md, 10)[0].text).toBe(
      `${'a'.repeat(30)} bold x c\\|d`,
    );
  });

  it('strips tags until nothing tag-shaped is left, and terminates', () => {
    const md = ['| A |', '|---|', '| <<b>b>text</b> <i>x |'].join('\n');
    // "<<b>" is one tag, the rest is text: "b>text x" (8 visible characters)
    expect(overlongTableLines(md, 8)).toEqual([]);
    expect(overlongTableLines(md, 7)[0].text).toBe('b>text x');
  });

  it('skips fenced code blocks and honours a custom limit', () => {
    const md = [
      '```',
      `| ${wide} |`,
      '```',
      '| A |',
      '|---|',
      '| abcdef |',
    ].join('\n');
    expect(overlongTableLines(md)).toEqual([]);
    expect(overlongTableLines(md, 3)).toEqual([
      { line: 6, column: 1, width: 6, text: 'abcdef' },
    ]);
  });

  it('ignores separator rows with alignment colons', () => {
    const md = ['| A | B |', '|:---|---:|', '| 1 | 2 |'].join('\n');
    expect(overlongTableLines(md)).toEqual([]);
  });
});

describe('formatFindings', () => {
  it('prints one file:line report per finding, truncating the text', () => {
    const [report] = formatFindings('README.md', [
      { line: 3, column: 2, width: 90, text: 'w'.repeat(80) },
    ]);
    expect(report).toBe(
      `README.md:3: table cell (column 2) has a 90-character line, limit ${MAX_LINE} - break it with <br>: "${'w'.repeat(60)}…"`,
    );
    expect(formatFindings('x.md', [], 10)).toEqual([]);
  });
});
