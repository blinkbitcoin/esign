// Which changes are documentation, and which commit range to read them from.
// ci.yml stops after Checks when a change is docs-only: Unit and E2E skip, and
// a skipped job counts as passing for required checks (unlike a workflow that
// never ran). One definition for every event - a PR and its merge to main get
// the same answer, which is the whole point of putting it here.

// "Docs" is docs/, any *.md, every LICENSE (the root one AND the per-package
// copies - `^LICENSE$` used to miss those, so a five-line copyright change ran
// the full matrix twice), and the issue / PR templates. Nothing else: workflow
// files change the thing under test, package.json and scripts feed the build.
const DOC_FILE =
  /^docs\/|\.md$|(^|\/)LICENSE$|^\.github\/(ISSUE_TEMPLATE|PULL_REQUEST_TEMPLATE)/;

/** Whether one changed path is documentation. */
export const isDocFile = path => DOC_FILE.test(path);

/**
 * Whether every changed path is documentation. An empty list is NOT docs-only:
 * "nothing changed" means the classifier learned nothing, so run the pipeline.
 * @param {readonly string[]} files
 */
export const isDocsOnly = files => files.length > 0 && files.every(isDocFile);

// A push whose base is the all-zero sha is the first push of a new branch:
// there is no previous commit to diff against.
const NO_COMMIT = /^0+$/;

/**
 * The `git diff` range for an event, or null when the change cannot be
 * classified - release and workflow_dispatch (which always run everything),
 * and any push or PR whose base is missing. Null always means "run the
 * pipeline": an unknown base must never be read as "docs-only".
 * @param {string | undefined} eventName
 * @param {{ before?: string, baseSha?: string }} shas
 * @returns {string | null}
 */
export const diffRange = (eventName, { before, baseSha } = {}) => {
  if (eventName === 'pull_request') {
    return baseSha ? `${baseSha}...HEAD` : null;
  }
  if (eventName === 'push') {
    return before && !NO_COMMIT.test(before) ? `${before}..HEAD` : null;
  }
  return null;
};
