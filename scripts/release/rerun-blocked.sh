#!/usr/bin/env bash
set -euo pipefail
: "${GH_TOKEN:?}" "${REPO:?}" "${SHA:?}"
gh api "repos/$REPO/actions/workflows/ci.yml/runs?head_sha=$SHA&per_page=30" \
  --jq '.workflow_runs[]
        | select(.conclusion == "failure")
        | select(.event == "release" or (.event == "workflow_dispatch" and (.head_branch | startswith("v"))))
        | "\(.id) \(.head_branch)"' \
| while read -r id tag; do
    echo "main is green for ${SHA::7}: re-running failed jobs of release run $id ($tag)"
    gh api -X POST "repos/$REPO/actions/runs/$id/rerun-failed-jobs" >/dev/null
  done
echo "done"
