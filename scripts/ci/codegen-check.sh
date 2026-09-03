#!/usr/bin/env bash
# Fails when apps/api/schema.graphql or the generated client code is stale.
# CI: E2E / Backend. Local: make codegen-check.
set -euo pipefail
cd "$(dirname "$0")/../.."
npm run codegen
# shellcheck disable=SC2016 # backticks in the message are markdown, not expansion
git diff --exit-code -- apps/api/schema.graphql 'packages/*/src/generated' \
  || { echo '::error::schema.graphql or generated client code is stale - run `make codegen` and commit'; exit 1; }
