#!/usr/bin/env bash
# Builds the service image (apps/api/Dockerfile) from the repo root with the
# OCI labels GHCR reads (source links the package to the repo; revision and
# version come from CI, empty locally). Optionally saves it as a gzipped
# archive for the Publish job, so what was smoked here is what ships.
#   scripts/ci/docker-build.sh <image> [archive.tar.gz]      (make docker-build)
# Env: GITHUB_REPOSITORY, GITHUB_SHA, VERSION (all optional).
set -euo pipefail
cd "$(dirname "$0")/../.."
IMAGE="${1:?image name}"
ARCHIVE="${2:-}"
LABELS=(--label "org.opencontainers.image.title=esign-api")
[ -n "${GITHUB_REPOSITORY:-}" ] && LABELS+=(--label "org.opencontainers.image.source=https://github.com/$GITHUB_REPOSITORY")
[ -n "${GITHUB_SHA:-}" ] && LABELS+=(--label "org.opencontainers.image.revision=$GITHUB_SHA")
[ -n "${VERSION:-}" ] && LABELS+=(--label "org.opencontainers.image.version=$VERSION")
docker build -f apps/api/Dockerfile -t "$IMAGE" "${LABELS[@]}" .
if [ -n "$ARCHIVE" ]; then
  docker save "$IMAGE" | gzip > "$ARCHIVE"
  echo "saved $IMAGE to $ARCHIVE ($(du -h "$ARCHIVE" | cut -f1))"
fi
