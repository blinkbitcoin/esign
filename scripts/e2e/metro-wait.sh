#!/usr/bin/env bash
# Waits for Metro (metro-start.sh) and prewarms the bundle for the given
# platform so the first Maestro launch does not race a cold compile.
# Usage: metro-wait.sh <ios|android>
set -euo pipefail
PLATFORM="${1:?usage: metro-wait.sh <ios|android>}"
for i in {1..60}; do
  if curl -s http://localhost:8081/status | grep -q packager-status:running; then
    echo "Metro is ready"; break
  fi
  echo "Waiting for Metro... ($i/60)"; sleep 2
done
curl -sf "http://localhost:8081/index.bundle?platform=${PLATFORM}&dev=true" -o /dev/null
echo "Bundle prewarmed (${PLATFORM})"
