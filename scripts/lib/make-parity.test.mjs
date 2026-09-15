import { describe, expect, it } from 'vitest';
import {
  formatViolations,
  isDelegation,
  normalize,
  parityViolations,
  stepsFrom,
  targetsFrom,
  targetWrapping,
} from './make-parity.mjs';

describe('normalize', () => {
  it('collapses whitespace', () => {
    expect(normalize('  bash   scripts/a.sh   x  ')).toBe(
      'bash scripts/a.sh x',
    );
  });

  it.each([
    [
      'bash scripts/ci/docker-build.sh esign-service $(ARCHIVE)',
      'bash scripts/ci/docker-build.sh esign-service',
    ],
    [
      'bash scripts/ci/docker-smoke.sh "${REF}"',
      'bash scripts/ci/docker-smoke.sh " "',
    ],
  ])('drops make expansions: %s', (input, expected) => {
    expect(normalize(input)).toBe(expected);
  });
});

describe('isDelegation', () => {
  it.each([
    'bash scripts/pack-smoke.sh',
    'node scripts/ci/changed-class.mjs',
    'sh scripts/e2e/test-db.sh up',
    'npm run build',
    'npm run test:coverage',
  ])('treats %s as a delegation', command => {
    expect(isDelegation(command)).toBe(true);
  });

  it.each([
    'npm ci --prefer-offline --no-audit',
    'docker run --rm rhysd/actionlint:latest',
    'make test-db-up',
    'npx audit-ci --config audit-ci.jsonc',
    'actionlint',
    '',
  ])('treats %s as nothing a target would wrap', command => {
    expect(isDelegation(command)).toBe(false);
  });
});

describe('targetsFrom', () => {
  const makefile = [
    'PACK_DEST ?= dist',
    '',
    '# a comment',
    'docker-build: ## Build the image',
    '\tbash scripts/ci/docker-build.sh esign-service $(ARCHIVE)',
    '',
    'docker-smoke: docker-build ## Boot it',
    '\tbash scripts/ci/docker-smoke.sh esign-service',
    '\t$(MAKE) test-db-up',
    '\tbash scripts/e2e/test-db.sh run-docker bash scripts/ci/docker-smoke.sh esign-service',
    '',
    'check-code: lint typecheck ## aggregate, no recipe',
    '',
    'image-smoke:',
    '\t@test -n "$(REF)" || exit 1',
    '\tbash scripts/ci/docker-smoke.sh "$(REF)"',
    '',
    'registry-smoke: ## Install a published version: make registry-smoke V=X.Y.Z',
    '\tbash scripts/release/registry-smoke.sh "$(V)"',
  ].join('\n');
  const targets = targetsFrom(makefile);

  it('normalizes each recipe command', () => {
    expect(targets['docker-build'].commands).toEqual([
      'bash scripts/ci/docker-build.sh esign-service',
    ]);
    expect(targets['docker-build'].prereqs).toEqual([]);
  });

  it('keeps every command of a multi-command recipe, $(MAKE) included', () => {
    expect(targets['docker-smoke'].commands).toHaveLength(3);
    expect(targets['docker-smoke'].commands[1]).toBe('test-db-up');
  });

  it('records the prerequisites a target runs first', () => {
    expect(targets['docker-smoke'].prereqs).toEqual(['docker-build']);
    expect(targets['check-code'].prereqs).toEqual(['lint', 'typecheck']);
  });

  it('strips a leading @ or - from a recipe line', () => {
    expect(targets['image-smoke'].commands[0]).toBe('test -n " " || exit 1');
  });

  it('records an aggregate target with no recipe as empty', () => {
    expect(targets['check-code'].commands).toEqual([]);
  });

  // A target whose help text shows a variable is still a target.
  it('keeps a target whose help text contains an = sign', () => {
    expect(Object.keys(targets)).toContain('registry-smoke');
    expect(targets['registry-smoke'].commands).toEqual([
      'bash scripts/release/registry-smoke.sh " "',
    ]);
  });

  it('does not treat a variable assignment as a target', () => {
    expect(Object.keys(targets)).not.toContain('PACK_DEST ?= dist');
  });
});

describe('targetWrapping', () => {
  const t = (commands, prereqs = []) => ({ commands, prereqs });
  const targets = {
    'e2e-server-demos': t(['bash scripts/e2e/server-demos-smoke.sh']),
    'test-db-up': t(['bash scripts/e2e/test-db.sh up']),
    'docker-smoke': t([
      'bash scripts/ci/docker-smoke.sh esign-service',
      'test-db-up',
    ]),
    'check-code': t([]),
    // One command, but prerequisites run first - so it is not "the" target
    // for that command. This is `check-ci: shellcheck audit check-parity`.
    'check-ci': t(['bash scripts/ci/actionlint.sh'], ['shellcheck', 'audit']),
  };

  it('names the target whose whole recipe is that command', () => {
    expect(
      targetWrapping(targets, 'bash scripts/e2e/server-demos-smoke.sh'),
    ).toBe('e2e-server-demos');
  });

  // The flaw this rule exists to avoid: `test-db.sh up` and `test-db.sh run …`
  // are different operations sharing a script. Matching on the script name
  // alone would tell CI to replace the second with `make test-db-up`.
  it('does not match a different invocation of the same script', () => {
    expect(
      targetWrapping(
        targets,
        'bash scripts/e2e/test-db.sh run npm run migrate:test',
      ),
    ).toBeUndefined();
  });

  it('does not claim a target that does more than the one command', () => {
    expect(
      targetWrapping(targets, 'bash scripts/ci/docker-smoke.sh esign-service'),
    ).toBeUndefined();
  });

  it('returns undefined when nothing wraps it', () => {
    expect(
      targetWrapping(targets, 'bash scripts/ci/free-disk.sh'),
    ).toBeUndefined();
  });
});

describe('parityViolations', () => {
  const t = (commands, prereqs = []) => ({ commands, prereqs });
  const targets = {
    'e2e-server-demos': t(['bash scripts/e2e/server-demos-smoke.sh']),
    'deploy-check': t(['bash scripts/ci/deploy-check.sh']),
    build: t(['npm run build']),
    'coverage-badge': t(['npm run coverage:badge']),
    version: t(['DRY_RUN=1 node scripts/release/resolve-version.mjs']),
  };

  it('flags a step that duplicates a target exactly', () => {
    expect(
      parityViolations(
        [
          {
            file: 'e2e.yml',
            line: 181,
            run: 'bash scripts/e2e/server-demos-smoke.sh',
          },
        ],
        targets,
      ),
    ).toEqual([
      {
        file: 'e2e.yml',
        line: 181,
        run: 'bash scripts/e2e/server-demos-smoke.sh',
        command: 'bash scripts/e2e/server-demos-smoke.sh',
        target: 'e2e-server-demos',
      },
    ]);
  });

  it('passes a step that already calls the target', () => {
    expect(
      parityViolations(
        [{ file: 'e2e.yml', line: 181, run: 'make e2e-server-demos' }],
        targets,
      ),
    ).toEqual([]);
  });

  it('passes a script no target wraps', () => {
    expect(
      parityViolations(
        [{ file: 'e2e.yml', line: 713, run: 'bash scripts/ci/free-disk.sh' }],
        targets,
      ),
    ).toEqual([]);
  });

  // `npm run coverage:badge -- --status failing` is not `make coverage-badge`.
  it('passes the same script run with different arguments', () => {
    expect(
      parityViolations(
        [
          {
            file: 'ci.yml',
            line: 191,
            run: 'npm run coverage:badge -- --status failing',
          },
        ],
        targets,
      ),
    ).toEqual([]);
  });

  // `make version` is DRY_RUN=1; CI stamps for real. Different operations.
  it('passes a command whose env prefix differs from the target', () => {
    expect(
      parityViolations(
        [
          {
            file: 'e2e.yml',
            line: 224,
            run: 'node scripts/release/resolve-version.mjs',
          },
        ],
        targets,
      ),
    ).toEqual([]);
  });

  it('ignores steps that are not delegations at all', () => {
    expect(
      parityViolations(
        [{ file: 'checks.yml', line: 70, run: 'npm ci --prefer-offline' }],
        targets,
      ),
    ).toEqual([]);
  });

  // An exception is a decision someone wrote down, not a silent difference.
  it('honours an allowed command', () => {
    expect(
      parityViolations(
        [
          {
            file: 'e2e.yml',
            line: 237,
            run: 'bash scripts/ci/deploy-check.sh',
          },
        ],
        targets,
        { 'bash scripts/ci/deploy-check.sh': 'because reasons' },
      ),
    ).toEqual([]);
  });

  it('is empty for no steps', () => {
    expect(parityViolations([], targets)).toEqual([]);
  });
});

describe('formatViolations', () => {
  it('names the command and the target that runs exactly it', () => {
    expect(
      formatViolations([
        {
          file: '.github/workflows/e2e.yml',
          line: 181,
          command: 'bash scripts/e2e/server-demos-smoke.sh',
          target: 'e2e-server-demos',
        },
      ]),
    ).toEqual([
      '.github/workflows/e2e.yml:181: runs `bash scripts/e2e/server-demos-smoke.sh` - use `make e2e-server-demos`, which runs exactly that, so the Makefile stays the one definition',
    ]);
  });

  it('is empty for no violations', () => {
    expect(formatViolations([])).toEqual([]);
  });
});

// A scanner that silently misses steps makes the gate report "ok" while
// checking nothing, so every shape a workflow can present is pinned here.
describe('stepsFrom', () => {
  const at = (text, file = 'w.yml') => stepsFrom(text, file);

  it('finds a one-line run under a step', () => {
    expect(
      at(['      - name: Build', '        run: make build'].join('\n')),
    ).toEqual([{ file: 'w.yml', line: 2, run: 'make build' }]);
  });

  it('finds a run on the same line as the dash', () => {
    expect(at('      - run: make build')).toEqual([
      { file: 'w.yml', line: 1, run: 'make build' },
    ]);
  });

  it('reports 1-based line numbers', () => {
    const steps = at(['a', 'b', 'c', '        run: make build'].join('\n'));
    expect(steps[0].line).toBe(4);
  });

  it('finds every line of a block, not the `run: |` line itself', () => {
    const text = [
      '        run: |',
      '          node scripts/a.mjs',
      '          node scripts/b.mjs',
      '      - name: Next',
    ].join('\n');
    expect(at(text)).toEqual([
      { file: 'w.yml', line: 2, run: '          node scripts/a.mjs' },
      { file: 'w.yml', line: 3, run: '          node scripts/b.mjs' },
    ]);
  });

  it('treats a blank line inside a block as part of it, not the end', () => {
    const text = [
      '        run: |',
      '          node scripts/a.mjs',
      '',
      '          node scripts/b.mjs',
      '      - name: Next',
    ].join('\n');
    expect(at(text).map(s => s.line)).toEqual([2, 4]);
  });

  it('ends a block at the first dedented line', () => {
    const text = [
      '        run: |',
      '          node scripts/a.mjs',
      '      - name: Next',
      '        run: make build',
    ].join('\n');
    expect(at(text).map(s => s.run)).toEqual([
      '          node scripts/a.mjs',
      'make build',
    ]);
  });

  it('handles a block that runs to the end of the file', () => {
    expect(
      at(['        run: |', '          node scripts/a.mjs'].join('\n')),
    ).toHaveLength(1);
  });

  it('handles a `run: |` with nothing after it', () => {
    expect(at('        run: |')).toEqual([]);
  });

  it('ignores keys that merely contain run, and other yaml', () => {
    const text = [
      '      - name: do not run this',
      '        uses: actions/checkout@v7',
      '        shell: bash',
      '        prerun: nope',
    ].join('\n');
    expect(at(text)).toEqual([]);
  });

  it('is empty for empty input', () => {
    expect(at('')).toEqual([]);
  });

  it('carries the file through to every step', () => {
    expect(at('        run: make build', 'e2e.yml')[0].file).toBe('e2e.yml');
  });
});
