#!/usr/bin/env bash
# Lints the workflows with ONE actionlint, whichever way it is reached.
#
# CI used to `docker run rhysd/actionlint:latest` while `make check-ci` ran the
# flake's binary, so the two could disagree about the same file: a floating tag
# against a pinned nixpkgs version. Now both call this, it prefers the local
# binary (the flake supplies it, so a dev shell needs no Docker) and falls back
# to the container at the SAME version - pinned, never :latest.
# Keep VERSION in step with flake.nix's actionlint when that moves.
set -euo pipefail
cd "$(dirname "$0")/../.."

VERSION=1.7.12

if command -v actionlint > /dev/null 2>&1; then
  local_version=$(actionlint --version | head -1)
  if [ "$local_version" != "$VERSION" ]; then
    echo "::notice::actionlint $local_version locally, $VERSION pinned in $0 - update the pin if the flake moved"
  fi
  exec actionlint -color
fi

exec docker run --rm -v "$PWD":/repo --workdir /repo "rhysd/actionlint:$VERSION" -color
