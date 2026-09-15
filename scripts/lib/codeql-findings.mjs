// The findings of a CodeQL SARIF run, as make codeql prints them: one line
// per result with its rule id, location and message, plus the count a local
// gate needs.
//
// Every finding counts as open, including one an inline `// codeql[<rule-id>]`
// marker suppressed. The CodeQL CLI honours such a marker and records it as a
// `suppressions` entry on the result - and GitHub code scanning ignores that
// property, so the alert is open there regardless. Reading it here is what
// made this gate report green on a finding that was red on GitHub, and is why
// the same false positive survived #58 and #81 (see
// .github/codeql/codeql-config.yml). A finding is either fixed or it is open.

const location = result => {
  const physical = result.locations?.[0]?.physicalLocation;
  const uri = physical?.artifactLocation?.uri ?? '<no location>';
  const line = physical?.region?.startLine;
  return line === undefined ? uri : `${uri}:${line}`;
};

/** Every result across the SARIF's runs, in report order. */
export const findings = sarif =>
  (sarif.runs ?? []).flatMap(run =>
    (run.results ?? []).map(result => ({
      ruleId: result.ruleId ?? '<no rule>',
      location: location(result),
      message: (result.message?.text ?? '').replace(/\s+/g, ' ').trim(),
    })),
  );

/** The report lines and the count for a run. */
export const summarize = sarif => {
  const all = findings(sarif);
  const lines = all.map(f => `${f.ruleId}  ${f.location}  ${f.message}`);
  lines.push(
    all.length === 0 ? 'codeql: no findings' : `codeql: ${all.length} open`,
  );
  return { open: all.length, lines };
};
