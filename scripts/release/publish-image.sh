#!/usr/bin/env bash
# Ships the service image E2E / Docker built and smoked: loads the archive,
# tags it <version> and <disttag> (latest / next, like the npm packages) and
# pushes both to GHCR. GitHub Packages never accepts a version tag twice for
# npm; a container tag can be overwritten, so the version tag is pushed
# first and the moving dist-tag last.
#   scripts/release/publish-image.sh <archive.tar.gz> <version> <disttag>
# Env: IMAGE (ghcr.io/<owner>/esign-api; the owner is lowercased here),
#      GHCR_USER, GHCR_TOKEN (GITHUB_TOKEN with packages:write).
# CI: Publish. Prints image= to $GITHUB_OUTPUT (stdout when unset).
set -euo pipefail
ARCHIVE="${1:?image archive}"; VERSION="${2:?version}"; DISTTAG="${3:?disttag}"
: "${IMAGE:?}" "${GHCR_USER:?}" "${GHCR_TOKEN:?}"
IMAGE="$(printf '%s' "$IMAGE" | tr '[:upper:]' '[:lower:]')"
LOCAL="$(docker load -q -i "$ARCHIVE" | sed -n 's/^Loaded image: //p' | head -n1)"
[ -n "$LOCAL" ] || { echo "::error::no image in $ARCHIVE"; exit 1; }
printf '%s' "$GHCR_TOKEN" | docker login ghcr.io -u "$GHCR_USER" --password-stdin
for tag in "$VERSION" "$DISTTAG"; do
  docker tag "$LOCAL" "$IMAGE:$tag"
  docker push "$IMAGE:$tag"
done
echo "image=$IMAGE:$VERSION" >> "${GITHUB_OUTPUT:-/dev/stdout}"
echo "published $IMAGE:$VERSION (+ :$DISTTAG)"
