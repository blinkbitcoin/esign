// Assembles docs/diagrams/README.md from the per-diagram sources in
// docs/diagrams/src/*.mmd. The .mmd files are canonical (editable /
// individually renderable); the combined page embeds the pre-rendered
// docs/diagrams/dist/*.svg (rendered by `make diagrams` via mermaid-cli) so
// it loads instantly on GitHub instead of booting eight mermaid iframes.
// Run `make diagrams` after editing a source. CI fails on drift (see
// test.yml); a missing SVG fails the assembly here.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'docs',
  'diagrams',
);

const SECTIONS = [
  {
    file: 'system-architecture.mmd',
    title: 'System Architecture',
    outro:
      'The public-URL mode needs no backend at all; Apollo/GraphQL is loaded only\n' +
      'by the proxy source (the `/webform` package entries never reach it).',
  },
  { file: 'data-flow-proxy.mmd', title: 'Data Flow Diagram (proxy mode)' },
  { file: 'signing-flow.mmd', title: 'Signing Flow Process' },
  { file: 'database-erd.mmd', title: 'Database ERD' },
  { file: 'component-hierarchy.mmd', title: 'Component Hierarchy' },
  { file: 'webhook-flow.mmd', title: 'Webhook Flow' },
  { file: 'graphql-request-flow.mmd', title: 'GraphQL Request Flow' },
  { file: 'webforms-flow.mmd', title: 'Web Forms Mode Flow' },
];

const blocks = SECTIONS.map(({ file, title, outro }) => {
  const svg = `dist/${file.replace(/\.mmd$/, '')}.svg`;
  if (!existsSync(join(here, svg))) {
    console.error(`missing ${svg} - run \`make diagrams\` to render it`);
    process.exit(1);
  }
  return `## ${title}\n\n[![${title}](${svg})](src/${file})\n${outro ? `\n${outro}\n` : ''}`;
});

const out = `<!-- GENERATED FILE - do not edit. Sources: src/*.mmd; run \`make diagrams\`. -->

# Diagrams

Pre-rendered SVGs for instant loading; click a diagram to open its editable
Mermaid source in [src/](src/) (which renders natively on GitHub, in VS Code,
and in Obsidian). Regenerate with \`make diagrams\`.

---

${blocks.join('\n---\n\n')}`;

writeFileSync(join(here, 'README.md'), `${out.trim()}\n`);
console.log(
  `assembled docs/diagrams/README.md from ${SECTIONS.length} sources`,
);
