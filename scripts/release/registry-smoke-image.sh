#!/usr/bin/env bash
# Consumes what was ACTUALLY published: pulls the image reference from GHCR
# and boots it through the same smoke the E2E / Docker job ran on the build.
#   scripts/release/registry-smoke-image.sh <image:tag>
# Env: GHCR_USER, GHCR_TOKEN (packages:read). CI: Verify.
set -euo pipefail
cd "$(dirname "$0")/../.."
REF="${1:?image reference}"
: "${GHCR_USER:?}" "${GHCR_TOKEN:?}"
printf '%s' "$GHCR_TOKEN" | docker login ghcr.io -u "$GHCR_USER" --password-stdin
docker pull -q "$REF"
bash scripts/ci/docker-smoke.sh "$REF"
