#!/usr/bin/env bash
# Stops a Metro started by metro-start.sh (best effort): the process that
# listens on 8081, then any leftover `react-native start` wrapper.
set -uo pipefail
lsof -t -iTCP:8081 -sTCP:LISTEN 2>/dev/null | xargs kill 2>/dev/null || true
pkill -f "react-native start" 2>/dev/null || true
