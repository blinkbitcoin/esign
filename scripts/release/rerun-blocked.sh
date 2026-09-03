#!/usr/bin/env bash
# When CI on main completes green for a commit, re-run the failed jobs of any
# release run tagged on that commit (its Publish refused to ship over a red
# main - see require-green-main.sh). Only Publish + Verify re-run; the gates
# already passed inside that run.
# Env: GH_TOKEN, REPO (owner/name), SHA (the green main commit). CI only.
set -euo pipefail
: "${GH_TOKEN:?}" "${REPO:?}" "${SHA:?}"
gh api "repos/$REPO/actions/workflows/ci.yml/runs?event=release&head_sha=$SHA&per_page=20" \
  --jq '.workflow_runs[] | select(.conclusion == "failure") | "\(.id) \(.head_branch)"' \
| while read -r id tag; do
    echo "main is green for ${SHA::7}: re-running failed jobs of release run $id ($tag)"
    gh api -X POST "repos/$REPO/actions/runs/$id/rerun-failed-jobs" >/dev/null
  done
echo "done"
