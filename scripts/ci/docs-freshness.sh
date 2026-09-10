#!/usr/bin/env bash
# Docs are hand-maintained alongside code (docs/index.md). Warns (never
# fails) when architecture-relevant files change without any docs/ update in
# the same push/PR. Hard rule (fails): a diagram source (docs/diagrams/src/
# *.mmd) may not change without its re-rendered SVG - `make diagrams`
# produces both; the pre-commit hook stages both.
# Range: PR -> origin/<BASE_REF>...HEAD; push -> HEAD~1; local -> origin/main.
# A package.json counts only when the change is structural (exports, scripts,
# workspaces...), not a dependency or version bump (scripts/ci/manifest-
# structural.mjs); a Dependabot PR is never expected to touch docs.
# Env: EVENT_NAME, BASE_REF, PR_AUTHOR (CI). CI: Checks / Docs. Local: make docs-check.
set -euo pipefail
cd "$(dirname "$0")/../.."
if [ "${EVENT_NAME:-}" = pull_request ]; then
  git fetch -q --no-tags --depth=1 origin "${BASE_REF:?}"
  BASE="origin/$BASE_REF"
elif [ -n "${EVENT_NAME:-}" ]; then
  BASE=HEAD~1
else
  BASE=origin/main
fi
CHANGED_FILES=$(git diff --name-only "$BASE"...HEAD 2>/dev/null || echo "")
MERGE_BASE=$(git merge-base "$BASE" HEAD 2>/dev/null || echo "$BASE")

ARCH_PATTERNS="esign-server/src/knex/migrations|\.graphql$|src/.*index\.ts$|providers/"
ARCH_CHANGES=$(echo "$CHANGED_FILES" | grep -E "$ARCH_PATTERNS" || true)
# shellcheck disable=SC2046 # manifest paths are one per line, whitespace-free
MANIFEST_CHANGES=$(node scripts/ci/manifest-structural.mjs "$MERGE_BASE" \
  $(echo "$CHANGED_FILES" | grep -E 'package\.json$' || true))
ARCH_CHANGES=$(printf '%s\n%s' "$ARCH_CHANGES" "$MANIFEST_CHANGES" | sed '/^$/d')
DOC_CHANGES=$(echo "$CHANGED_FILES" | grep -E "^docs/|README\.md$" || true)

# (grep exits 1 when nothing matched; with pipefail that must not abort us)
STALE_SVGS=$(echo "$CHANGED_FILES" | { grep -E '^docs/diagrams/src/.*\.mmd$' || true; } | while read -r f; do
  svg="docs/diagrams/dist/$(basename "$f" .mmd).svg"
  echo "$CHANGED_FILES" | grep -qx "$svg" || printf ' %s' "$f"
done)
if [ -n "$STALE_SVGS" ]; then
  echo "::error::Diagram sources changed without re-rendered SVGs:$STALE_SVGS - run 'make diagrams' and commit the SVGs"
  exit 1
fi

if [ "${PR_AUTHOR:-}" = "dependabot[bot]" ]; then
  echo "Docs check OK (dependency update by Dependabot - no docs expected)"
elif [ -n "$ARCH_CHANGES" ] && [ -z "$DOC_CHANGES" ]; then
  echo "::warning::Architecture-relevant files changed but docs were not updated:"
  echo "$ARCH_CHANGES"
  echo ""
  echo "Consider updating documentation if these changes affect:"
  echo "  - API contracts (GraphQL schema)"
  echo "  - Database models (knex migrations)"
  echo "  - System architecture (new services/components)"
  {
    echo "## Documentation Status"
    echo ""
    echo ":warning: Architecture-relevant files changed without a docs/ update:"
    echo '```'
    echo "$ARCH_CHANGES"
    echo '```'
  } >> "${GITHUB_STEP_SUMMARY:-/dev/null}"
else
  echo "Docs check OK"
fi
