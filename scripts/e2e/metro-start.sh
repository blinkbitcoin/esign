#!/usr/bin/env bash
# Starts Metro for the React Native demo in the background so its boot
# overlaps the rest of the setup; metro-wait.sh awaits it. Log:
# $RUNNER_TEMP/metro.log (or /tmp).
set -euo pipefail
cd "$(dirname "$0")/../../examples/react-native-demo"
npm start > "${RUNNER_TEMP:-/tmp}/metro.log" 2>&1 &
echo "Metro starting (pid $!)"
