// The environment contract, rendered.
//
// Everything that used to be hand-written in ten places comes from
// registry.ts through here: the .env example and the per-audience doc
// tables. `scripts/ci/env-docs.mjs` writes them between BEGIN/END markers so
// the prose around them survives, and `--check` fails when they are stale -
// the same shape as the diagrams check.

import { type Audience, type EnvVar, REGISTRY, type Runtime } from './registry';

// The doc tables cap a cell line at the house width (scripts/ci/docs-tables.mjs),
// so long text is broken with <br> rather than wrapped by GitHub.
const CELL_WIDTH = 72;

// Env-file comments wrap a little wider, since `# ` is the only decoration
const COMMENT_WIDTH = 74;

// Greedy word wrap. The first word always starts a line and every later word
// either fits or starts the next one, so both branches are ordinary.
const wrapTo = (text: string, width: number): string[] =>
  text.split(' ').reduce<string[]>((lines, word) => {
    const last = lines[lines.length - 1];
    if (last !== undefined && `${last} ${word}`.length <= width) {
      return [...lines.slice(0, -1), `${last} ${word}`];
    }
    return [...lines, word];
  }, []);

// A value as one table cell's text: newlines flattened to spaces, and the two
// characters that would break the table escaped.
//
// Both in one pass. Escaping `|` and then `\` would double the backslash this
// step just added; escaping `\` and then `|` is correct but only by ordering,
// and an escaper whose correctness depends on the order of two replaces is one
// refactor away from being wrong again.
export const escapeCell = (text: string): string =>
  text
    .replace(/\s*\n\s*/g, ' ')
    .replace(/([\\|])/g, '\\$1')
    .trim();

// One table cell, broken with <br> to the house width
const cell = (text: string): string => wrapTo(escapeCell(text), CELL_WIDTH).join('<br>');

// Comment every line of `text` for an env file, wrapping prose but leaving
// anything already indented (a command to run) exactly as written.
const commented = (text: string): string =>
  text
    .split('\n')
    .flatMap((line) => (line.startsWith(' ') ? [line] : wrapTo(line, COMMENT_WIDTH)))
    .map((line) => `# ${line}`)
    .join('\n');

const forAudience = (audience: Audience) =>
  REGISTRY.filter((entry) => entry.audience === audience || entry.audience === 'both');

// One variable as an env-file stanza: why it exists, how to get it, then the
// line itself, commented out unless it has no sensible default.
const envStanza = (entry: EnvVar): string => {
  const parts = [commented(entry.why)];
  if (entry.howToObtain) {
    parts.push(commented(`How to obtain:\n${entry.howToObtain}`));
  }
  parts.push(
    commented(entry.default ? `Default: ${entry.default}` : `Required: ${entry.requiredWhen}`)
  );
  parts.push(`# ${entry.name}=`);
  return parts.join('\n');
};

// The whole .env example, in registry order
export const renderEnvExample = (): string => REGISTRY.map(envStanza).join('\n\n');

// The table an audience reads: what it does, when it is needed, and - the
// column that never existed - where the value comes from.
export const renderDocTable = (audience: Audience): string => {
  const rows = forAudience(audience).map((entry) => {
    const need = entry.default ? `default: ${entry.default}` : entry.requiredWhen;
    const how = entry.howToObtain ?? '—';
    return `| \`${entry.name}\` | ${cell(entry.why)} | ${cell(need)} | ${cell(how)} |`;
  });
  return ['| Variable | Why | When | How to obtain |', '|---|---|---|---|', ...rows].join('\n');
};

// Which variables a target actually supports, for the deploy manifests
export const renderForTarget = (target: Runtime): string =>
  REGISTRY.filter((entry) => entry.targets.includes(target))
    .map(
      (entry) => `${entry.name}: ${entry.default ? `default ${entry.default}` : entry.requiredWhen}`
    )
    .join('\n');
