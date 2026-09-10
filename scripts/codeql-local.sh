#!/usr/bin/env bash
# GitHub's CodeQL analysis on this machine: the same language, config
# (query suite + the alert-suppression query that makes an inline
# `// codeql[<rule-id>]` marker count) and therefore the same findings as
# .github/workflows/codeql.yml - before a push, and with the markers shown
# as suppressed or not. LOCAL ONLY: CI runs CodeQL on GitHub; nothing calls
# this from a workflow.
#   make codeql
# The CLI comes from the flake (`nix shell .#codeql`, fetched once) unless a
# `codeql` is already on PATH (Homebrew, gh codeql). Output: .codeql/ (the
# database and results.sarif, gitignored). The first run downloads and
# compiles the query pack (minutes); later runs reuse it. Exit 1 when an
# unsuppressed finding remains, so it works as a local gate.
set -euo pipefail
cd "$(dirname "$0")/.."

if ! command -v codeql > /dev/null 2>&1; then
  [ -z "${CODEQL_LOCAL_NIX:-}" ] || { echo "::error::codeql is not on PATH even inside nix shell .#codeql"; exit 1; }
  echo "== codeql from the flake (nix shell .#codeql; the first time fetches it)"
  CODEQL_LOCAL_NIX=1 exec nix shell ".#codeql" --command bash "$0" "$@"
fi

CONFIG=.github/codeql/codeql-config.yml
OUT=.codeql
DB="$OUT/db"
SARIF="$OUT/results.sarif"
mkdir -p "$OUT"
echo "== codeql $(codeql version --format=terse), config $CONFIG"

# The same queries the workflow runs, read from its config: the suite
# (`uses: security-and-quality` is the action's shorthand for the pack's
# javascript-security-and-quality.qls; the CLI wants the path) and every
# extra pack (the AlertSuppression query that makes the markers count).
SUITE=$(sed -n 's/^ *- uses: *//p' "$CONFIG" | head -1)
[ -n "$SUITE" ] || { echo "::error::no 'uses:' suite in $CONFIG"; exit 1; }
QUERIES=("codeql/javascript-queries:codeql-suites/javascript-$SUITE.qls")
while IFS= read -r pack; do QUERIES+=("$pack"); done < <(sed -n 's/^ *- \(codeql\/[^ ]*\)$/\1/p' "$CONFIG")

echo "== database (javascript-typescript, no build step; build output skipped like a CI checkout)"
# What a fresh checkout does not contain: build output, native projects,
# vendored gems, this tool's own output
LGTM_INDEX_FILTERS=$(printf 'exclude:**/dist\nexclude:**/lib\nexclude:**/build\nexclude:**/coverage\nexclude:**/android\nexclude:**/ios\nexclude:**/vendor\nexclude:.codeql')
export LGTM_INDEX_FILTERS
codeql database create "$DB" \
  --language=javascript-typescript \
  --source-root . \
  --overwrite > "$OUT/create.log" 2>&1 || { tail -30 "$OUT/create.log"; echo "::error::database create failed (full log: $OUT/create.log)"; exit 1; }

echo "== analyze: ${QUERIES[*]} (the pack is downloaded once)"
codeql database analyze "$DB" "${QUERIES[@]}" \
  --download \
  --format=sarif-latest \
  --output="$SARIF" > "$OUT/analyze.log" 2>&1 || { tail -30 "$OUT/analyze.log"; echo "::error::analyze failed (full log: $OUT/analyze.log)"; exit 1; }

echo "== findings ($SARIF)"
node scripts/codeql-findings.mjs "$SARIF"
