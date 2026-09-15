// Keeps the Makefile the single definition of what CI runs.
//
// The workflows already obey "no inline shell" (CLAUDE.md): almost every step
// is one delegation. The failure mode that actually bit us is the other one -
// a workflow calling `bash scripts/foo.sh` directly while `make foo` runs the
// same command, so the two drift. They had, three ways: the mint-only smoke
// port was frozen at 4104 in the workflow and derived in the Makefile, the
// coverage gate ran an extra check locally that CI never ran, and actionlint
// was a floating container in CI against a pinned binary locally.
//
// The comparison is the WHOLE command, not the script name. `test-db.sh up`
// and `test-db.sh run npm run migrate:test` are different operations that
// happen to share a script, and telling someone to replace the second with
// `make test-db-up` would be wrong. Only an exact match is a violation, which
// makes the rule conservative on purpose: it reports real duplicates and
// stays quiet everywhere else.

// A make expansion carries no meaning for the comparison - `$(ARCHIVE)` is
// empty unless a caller sets it - so it is dropped before matching.
const MAKE_VAR = /\$[({][^)}]*[)}]/g;

/** A command line reduced to what is worth comparing. */
export const normalize = command =>
  command.replace(MAKE_VAR, ' ').replace(/\s+/g, ' ').trim();

/** Whether a command runs a repo script or an npm script (the ones a target could wrap). */
export const isDelegation = command =>
  /(?:^|\s)(?:bash|sh|node|npx)\s+scripts\//.test(command) ||
  /(?:^|\s)npm\s+run\s+/.test(command);

/**
 * Makefile source → { target: { prereqs, commands } }. Recipe lines are
 * TAB-indented; `@`/`-` prefixes and `$(MAKE)` lines are kept as written,
 * since a target that also runs make does more than one thing. Prerequisites
 * are captured too: `check-ci: shellcheck audit` runs those first, so its
 * recipe alone does not describe what the target does.
 * @param {string} makefile
 */
export const targetsFrom = makefile => {
  const targets = {};
  let current = null;
  for (const line of makefile.split('\n')) {
    // A variable assignment (`PACK_DEST ?= dist`) is not a target; anything
    // else of the form `name: prereqs ## help` is. Matching on "no = in the
    // line" would drop every target whose help text shows a variable, e.g.
    // `registry-smoke: ## ... make registry-smoke V=X.Y.Z`.
    if (/^[A-Za-z_][\w-]*\s*[:?+]?=/.test(line)) {
      current = null;
      continue;
    }
    const header = /^([a-z][\w-]*):(.*)$/.exec(line);
    if (header) {
      current = header[1];
      targets[current] = {
        prereqs: header[2].split('##')[0].trim().split(/\s+/).filter(Boolean),
        commands: [],
      };
      continue;
    }
    if (current && line.startsWith('\t')) {
      targets[current].commands.push(normalize(line.replace(/^\t[@-]?/, '')));
      continue;
    }
    if (line.trim() !== '' && !line.startsWith('\t')) {
      current = null;
    }
  }
  return targets;
};

/**
 * The target whose entire job is this one command, or undefined. A target that
 * runs several commands - or any prerequisite - is not "the" target for any
 * one of them: `make docker-smoke` also brings a database up and tears it
 * down, and `make check-ci` runs shellcheck and the audit first, so a step
 * that only runs one of those pieces is not asking for that target.
 * @param {Record<string, {prereqs: string[], commands: string[]}>} targets
 * @param {string} command - already normalized
 */
export const targetWrapping = (targets, command) =>
  Object.keys(targets).find(
    name =>
      targets[name].prereqs.length === 0 &&
      targets[name].commands.length === 1 &&
      targets[name].commands[0] === command,
  );

/**
 * Workflow steps that should call a make target instead of the command.
 * @param {{file: string, line: number, run: string}[]} steps
 * @param {Record<string, {prereqs: string[], commands: string[]}>} targets
 * @param {Record<string, string>} allowed - normalized command → why it stays
 */
export const parityViolations = (steps, targets, allowed = {}) => {
  const violations = [];
  for (const step of steps) {
    const command = normalize(step.run);
    if (!isDelegation(command) || command in allowed) {
      continue;
    }
    const target = targetWrapping(targets, command);
    if (target) {
      violations.push({ ...step, command, target });
    }
  }
  return violations;
};

/** One report line per violation, pointing at the fix. */
export const formatViolations = violations =>
  violations.map(
    v =>
      `${v.file}:${v.line}: runs \`${v.command}\` - use \`make ${v.target}\`, which runs exactly that, so the Makefile stays the one definition`,
  );

/**
 * Every `run:` line in a workflow, with the line it came from. A hand-rolled
 * scan rather than a YAML parse: the report needs line numbers, and the only
 * shapes here are `run: one-liner` and `run: |` blocks.
 *
 * Under-reporting is the dangerous failure: a scanner that silently misses
 * steps makes the gate pass while checking nothing, so every shape it can
 * meet is pinned in the table test.
 * @param {string} text - workflow source
 * @param {string} file - for the report
 * @returns {{file: string, line: number, run: string}[]}
 */
export const stepsFrom = (text, file) => {
  const steps = [];
  const lines = text.split('\n');
  // `^\s*` matches anything, including '', so exec never returns null here.
  const indentOf = line => /^\s*/.exec(line)[0].length;
  for (let i = 0; i < lines.length; i++) {
    const inline = /^\s*(?:- )?run:\s+(?!\|)(.+)$/.exec(lines[i]);
    if (inline) {
      steps.push({ file, line: i + 1, run: inline[1] });
      continue;
    }
    if (!/^\s*(?:- )?run:\s*\|/.test(lines[i])) {
      continue;
    }
    // A block ends at the first non-blank line indented less than its first
    // line; blank lines inside it are skipped, not terminators.
    const indent = indentOf(lines[i + 1] ?? '');
    for (let j = i + 1; j < lines.length; j++) {
      if (lines[j].trim() === '') {
        continue;
      }
      if (indentOf(lines[j]) < indent) {
        break;
      }
      steps.push({ file, line: j + 1, run: lines[j] });
    }
  }
  return steps;
};
