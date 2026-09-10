import { describe, expect, it } from 'vitest';
import { findings, summarize } from './codeql-findings.mjs';

const result = (ruleId, uri, line, text, extra = {}) => ({
  ruleId,
  message: { text },
  locations: [
    {
      physicalLocation: {
        artifactLocation: { uri },
        region: { startLine: line },
      },
    },
  ],
  ...extra,
});

const sarif = {
  runs: [
    {
      results: [
        result(
          'js/insufficient-password-hash',
          'src/auth.ts',
          45,
          'Password  from\n a call.',
          {
            suppressions: [{ kind: 'inSource' }],
          },
        ),
        result('js/unused-local-variable', 'src/x.ts', 3, 'Unused variable y.'),
      ],
    },
    { results: [{ ruleId: 'js/no-location', message: { text: 'nowhere' } }] },
  ],
};

describe('findings', () => {
  it('reads rule, location, message and the in-source suppression from every run', () => {
    expect(findings(sarif)).toEqual([
      {
        ruleId: 'js/insufficient-password-hash',
        location: 'src/auth.ts:45',
        message: 'Password from a call.',
        suppressed: true,
      },
      {
        ruleId: 'js/unused-local-variable',
        location: 'src/x.ts:3',
        message: 'Unused variable y.',
        suppressed: false,
      },
      {
        ruleId: 'js/no-location',
        location: '<no location>',
        message: 'nowhere',
        suppressed: false,
      },
    ]);
  });

  it('tolerates a SARIF with no runs, results, rule or message', () => {
    expect(findings({})).toEqual([]);
    expect(findings({ runs: [{}] })).toEqual([]);
    expect(
      findings({
        runs: [
          {
            results: [
              {
                locations: [
                  { physicalLocation: { artifactLocation: { uri: 'a.ts' } } },
                ],
              },
            ],
          },
        ],
      }),
    ).toEqual([
      { ruleId: '<no rule>', location: 'a.ts', message: '', suppressed: false },
    ]);
  });
});

describe('summarize', () => {
  it('lists every finding, marks the suppressed ones and counts both', () => {
    const { open, suppressed, lines } = summarize(sarif);
    expect(open).toBe(2);
    expect(suppressed).toBe(1);
    expect(lines).toEqual([
      'suppressed  js/insufficient-password-hash  src/auth.ts:45  Password from a call.',
      'open        js/unused-local-variable  src/x.ts:3  Unused variable y.',
      'open        js/no-location  <no location>  nowhere',
      'codeql: 2 open, 1 suppressed by an inline marker',
    ]);
  });

  it('says so when there is nothing', () => {
    expect(summarize({ runs: [] })).toEqual({
      open: 0,
      suppressed: 0,
      lines: ['codeql: no findings'],
    });
  });
});
