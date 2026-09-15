#!/usr/bin/env node
// Write the environment contract everywhere it is documented, from the one
// place it is declared (packages/esign-service/src/env/registry.ts).
//
// Each target carries BEGIN/END markers, so the prose around a generated
// block survives. `--check` regenerates in memory and fails when a target is
// stale, the same shape as scripts/ci/diagrams-check.sh - so "you changed a
// variable and not the docs" is a red build rather than something a reviewer
// has to notice.
//
// Run by `make env-docs`, checked by `make docs-check`.

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  renderDocTable,
  renderEnvExample,
} from '../../packages/esign-service/src/env/render.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

const BEGIN = tag =>
  `<!-- BEGIN GENERATED ${tag} - edit packages/esign-service/src/env/registry.ts -->`;
const END = '<!-- END GENERATED -->';

// The same markers in an env file, where HTML comments would be noise
const ENV_BEGIN =
  '# BEGIN GENERATED - edit packages/esign-service/src/env/registry.ts';
const ENV_END = '# END GENERATED';

const TARGETS = [
  {
    file: 'packages/esign-service/.env.example',
    begin: ENV_BEGIN,
    end: ENV_END,
    content: () => renderEnvExample(),
  },
  {
    file: 'docs/development-guide.md',
    begin: BEGIN('env operator'),
    end: END,
    content: () => renderDocTable('operator'),
  },
  {
    file: 'docs/operations/production.md',
    begin: BEGIN('env operator'),
    end: END,
    content: () => renderDocTable('operator'),
  },
  {
    file: 'docs/architecture/backend.md',
    begin: BEGIN('env backend'),
    end: END,
    content: () => renderDocTable('backend'),
  },
  {
    file: 'packages/esign-service/README.md',
    begin: BEGIN('env operator'),
    end: END,
    content: () => renderDocTable('operator'),
  },
];

// Replace what sits between the markers. A file without them is an error:
// silently doing nothing is how the old ten places drifted.
const replaceBlock = (text, begin, end, content, file) => {
  const from = text.indexOf(begin);
  const to = text.indexOf(end, from);
  if (from === -1 || to === -1) {
    throw new Error(
      `${file}: no generated block - add the markers:\n${begin}\n${end}`,
    );
  }
  return `${text.slice(0, from)}${begin}\n${content}\n${text.slice(to)}`;
};

const check = process.argv.includes('--check');
const stale = [];

for (const target of TARGETS) {
  const path = join(ROOT, target.file);
  const current = readFileSync(path, 'utf8');
  const next = replaceBlock(
    current,
    target.begin,
    target.end,
    target.content(),
    target.file,
  );
  if (current === next) {
    continue;
  }
  if (check) {
    stale.push(target.file);
  } else {
    writeFileSync(path, next);
    console.log(`wrote ${target.file}`);
  }
}

if (stale.length > 0) {
  for (const file of stale) {
    console.error(
      `::error file=${file}::${file} is out of date - run \`make env-docs\` and commit`,
    );
  }
  process.exit(1);
}

console.log(check ? 'env docs: ok' : `env docs: ${TARGETS.length} files`);
