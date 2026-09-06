#!/usr/bin/env bash
# When CI on main completes green for a commit, re-run the failed jobs of any
# release run tagged on that commit (its Publish refused to ship over a red
# main - see require-green-main.sh). Only Publish + Verify re-run; the gates
# already passed inside that run. A release run is either a `release` event
# (hand-cut rc tag) or the dispatch release.yml starts at the new tag,
# which runs at a `v*` ref.
# Env: GH_TOKEN, REPO (owner/name), SHA (the green main commit). CI only.
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
