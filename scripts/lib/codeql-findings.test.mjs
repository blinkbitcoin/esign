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
            // The CLI honoured an inline marker here. GitHub ignores this
            // property, so the finding still counts as open - see the module.
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
  it('reads rule, location and message from every run', () => {
    expect(findings(sarif)).toEqual([
      {
        ruleId: 'js/insufficient-password-hash',
        location: 'src/auth.ts:45',
        message: 'Password from a call.',
      },
      {
        ruleId: 'js/unused-local-variable',
        location: 'src/x.ts:3',
        message: 'Unused variable y.',
      },
      {
        ruleId: 'js/no-location',
        location: '<no location>',
        message: 'nowhere',
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
    ).toEqual([{ ruleId: '<no rule>', location: 'a.ts', message: '' }]);
  });
});

describe('summarize', () => {
  // The regression this file exists for: a suppressed finding used to be
  // reported as handled and excluded from the count, so the gate exited 0
  // while the alert was open on GitHub.
  it('counts a finding the CLI suppressed as open like any other', () => {
    const { open, lines } = summarize(sarif);
    expect(open).toBe(3);
    expect(lines).toEqual([
      'js/insufficient-password-hash  src/auth.ts:45  Password from a call.',
      'js/unused-local-variable  src/x.ts:3  Unused variable y.',
      'js/no-location  <no location>  nowhere',
      'codeql: 3 open',
    ]);
  });

  it('says so when there is nothing', () => {
    expect(summarize({ runs: [] })).toEqual({
      open: 0,
      lines: ['codeql: no findings'],
    });
  });
});
