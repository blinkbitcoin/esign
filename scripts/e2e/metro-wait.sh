#!/usr/bin/env bash
# Waits for Metro (metro-start.sh) and prewarms the bundle for the given
# platform so the first Maestro launch does not race a cold compile.
# Usage: metro-wait.sh <ios|android>
set -euo pipefail
PLATFORM="${1:?usage: metro-wait.sh <ios|android>}"
# shellcheck source=scripts/e2e/wait-lib.sh
. "$(dirname "$0")/wait-lib.sh"
metro_running() { curl -s http://localhost:8081/status | grep -q packager-status:running; }
wait_for Metro 60 2 "" metro_running
# The exact options the dev clients request (RCTBundleURLProvider.mm,
# DevServerHelper.kt: dev + lazy, unminified, run the module) so Metro's
# per-options bundle cache answers the app's first request instead of
# building a second graph. `app=<id>` is omitted: Metro ignores it.
curl -sf "http://localhost:8081/index.bundle?platform=${PLATFORM}&dev=true&lazy=true&minify=false&modulesOnly=false&runModule=true" -o /dev/null
echo "Bundle prewarmed (${PLATFORM})"
