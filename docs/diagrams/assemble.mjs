// Assembles docs/diagrams/mermaid-diagrams.md from the per-diagram sources
// in src/*.mmd. The .mmd files are canonical (editable / individually
// renderable); the combined file is generated - run `make diagrams` after
// editing a source. CI fails on drift (see test.yml).
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

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
  const source = readFileSync(join(here, 'src', file), 'utf8').trim();
  return `## ${title}\n\n\`\`\`mermaid\n${source}\n\`\`\`\n${outro ? `\n${outro}\n` : ''}`;
});

const out = `<!-- GENERATED FILE - do not edit. Sources: src/*.mmd; run \`make diagrams\`. -->

# Diagrams (Mermaid)

These diagrams render automatically in GitHub, GitLab, Obsidian, and VS Code.
Each diagram's editable source lives in [src/](src/).

---

${blocks.join('\n---\n\n')}`;

writeFileSync(join(here, 'mermaid-diagrams.md'), `${out.trim()}\n`);
console.log(`assembled mermaid-diagrams.md from ${SECTIONS.length} sources`);
