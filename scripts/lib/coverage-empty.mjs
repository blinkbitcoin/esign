// Coverage rows with nothing to cover. A re-export barrel or a type-only
// module has zero statements, so istanbul/v8 print it as 0% in every column
// while the totals stay at 100 - noise that reads as a hole. The house rule:
// such modules are excluded from coverage in their workspace's config, and
// this check (run by `make coverage`) fails when one slips through.

/** Files in a coverage-summary.json with no statements at all. */
export const emptyCoverageFiles = summary =>
  Object.entries(summary)
    .filter(
      ([file, metrics]) => file !== 'total' && metrics?.statements?.total === 0,
    )
    .map(([file]) => file);

/**
 * The workspaces `make coverage` runs: every `-w <path>` in the root
 * package.json's test:coverage script. Each must leave a
 * coverage-summary.json behind, or this check never sees it (a workspace
 * whose reporter list lacks json-summary is invisible, not clean).
 */
export const coverageWorkspaces = script =>
  [...script.matchAll(/(?:^|\s)-w\s+(\S+)/g)].map(match => match[1]);

/** The workspaces that ran coverage but wrote no summary. */
export const missingSummaries = (workspaces, summaryFiles) =>
  workspaces.filter(
    workspace =>
      !summaryFiles.some(file =>
        file.endsWith(`${workspace}/coverage/coverage-summary.json`),
      ),
  );

/** One report line per empty file, pointing at the fix. */
export const formatEmptyFiles = (workspace, files) =>
  files.map(
    file =>
      `${workspace}: ${file} has no statements to cover - exclude it from coverage in the workspace config (re-export / type-only module)`,
  );
