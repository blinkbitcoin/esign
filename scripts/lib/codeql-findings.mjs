// The findings of a CodeQL SARIF run, as make codeql prints them: one line
// per result with its rule id, location and message, marked when an inline
// `// codeql[<rule-id>]` comment suppresses it (the AlertSuppression query
// in .github/codeql/codeql-config.yml records that as a `suppressions`
// entry on the result), plus the open / suppressed counts a local gate
// needs.

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
      suppressed: (result.suppressions ?? []).length > 0,
    })),
  );

/** The report lines and the counts for a run. */
export const summarize = sarif => {
  const all = findings(sarif);
  const open = all.filter(f => !f.suppressed).length;
  const suppressed = all.length - open;
  const lines = all.map(
    f =>
      `${f.suppressed ? 'suppressed' : 'open      '}  ${f.ruleId}  ${f.location}  ${f.message}`,
  );
  lines.push(
    all.length === 0
      ? 'codeql: no findings'
      : `codeql: ${open} open, ${suppressed} suppressed by an inline marker`,
  );
  return { open, suppressed, lines };
};
