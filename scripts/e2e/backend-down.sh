#!/usr/bin/env bash
# Stops a backend started by backend-up.sh (best effort).
set -uo pipefail
pkill -f "npm run dev" || true
