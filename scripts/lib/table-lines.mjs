// Markdown tables on GitHub share the page width in proportion to their
// content: one long cell squeezes the other columns until their code spans
// wrap word by word (`make` / `coverage-` / `badge`). The house rule (#45,
// #47): every table cell is written as lines of at most MAX_LINE visible
// characters, broken with `<br>`. This module finds the cells that break the
// rule so docs-check can fail instead of a reviewer noticing later.

export const MAX_LINE = 72;

// Visible width of a cell line: markdown/HTML decoration does not take
// space on the page.
const stripTags = text => {
  let previous;
  let current = text;
  do {
    previous = current;
    current = current.replace(/<[^>]*>/g, '');
  } while (current !== previous); // nested/partial tags: repeat until stable
  return current;
};

const visible = text =>
  stripTags(text)
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1') // links → their text
    .replace(/[`*_]/g, '') // code, emphasis
    .replace(/&nbsp;/g, ' ')
    .trim();

const isTableRow = line => /^\s*\|.*\|\s*$/.test(line);
const isSeparator = line => /^\s*\|(\s*:?-+:?\s*\|)+\s*$/.test(line);

// Cells of a row, ignoring the outer pipes and escaped `\|`
const cells = line =>
  line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split(/(?<!\\)\|/)
    .map(cell => cell.trim());

/**
 * Every cell line in `markdown`'s tables that is wider than `max`, as
 * `{ line, column, width, text }` (1-based line numbers). Fenced code
 * blocks are skipped.
 */
export const overlongTableLines = (markdown, max = MAX_LINE) => {
  const findings = [];
  let inFence = false;
  const lines = markdown.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*```/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence || !isTableRow(line) || isSeparator(line)) {
      continue;
    }
    cells(line).forEach((cell, column) => {
      for (const segment of cell.split(/<br\s*\/?>/i)) {
        const width = visible(segment).length;
        if (width > max) {
          findings.push({
            line: i + 1,
            column: column + 1,
            width,
            text: visible(segment),
          });
        }
      }
    });
  }
  return findings;
};

/** One report line per finding, for the CI log. */
export const formatFindings = (file, findings, max = MAX_LINE) =>
  findings.map(
    f =>
      `${file}:${f.line}: table cell (column ${f.column}) has a ${f.width}-character line, limit ${max} - break it with <br>: "${f.text.slice(0, 60)}…"`,
  );
