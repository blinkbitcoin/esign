#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."

# One scanner for every ecosystem the repo locks: the npm workspace and the
# React Native demo's CocoaPods bundle. Accepted findings live in
# osv-scanner.toml, each with a reason.
VERSION=2.5.0
ARGS=(scan source --config osv-scanner.toml
  -L package-lock.json
  -L examples/react-native-demo/Gemfile.lock)

if command -v osv-scanner > /dev/null 2>&1; then
  local_version=$(osv-scanner --version | sed -n 's/^osv-scanner version: //p')
  if [ "$local_version" != "$VERSION" ]; then
    echo "::notice::osv-scanner $local_version locally, $VERSION pinned in $0 - update the pin if the flake moved"
  fi
  exec osv-scanner "${ARGS[@]}"
fi

exec docker run --rm -v "$PWD":/repo --workdir /repo "ghcr.io/google/osv-scanner:v$VERSION" "${ARGS[@]}"
