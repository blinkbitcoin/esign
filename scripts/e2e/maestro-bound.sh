#!/usr/bin/env bash
# Sourced by android-maestro.sh and ios-maestro.sh. A starved emulator or
# simulator can leave Maestro waiting on its driver with no flow output (#41).
# Bound the suite here, inside the script, so what follows (the Android logcat
# post-mortem, the iOS suite retry decision) still runs: the step's
# timeout-minutes is only the backstop and kills the script outright.
#
#   bounded_maestro <npm run args...>   -> exit status; 124 when the bound hit
#
# coreutils `timeout` on ubuntu runners, `gtimeout` (Homebrew coreutils) on
# macOS runners; neither on a stock Mac, where the suite runs unbounded.
MAESTRO_SUITE_TIMEOUT="${MAESTRO_SUITE_TIMEOUT:-10m}"

bounded_maestro() {
  local t
  if t=$(command -v timeout || command -v gtimeout); then
    "$t" -k 30s "$MAESTRO_SUITE_TIMEOUT" npm run "$@"
    local status=$?
    if [ "$status" -eq 124 ]; then
      echo "::error::Maestro suite exceeded $MAESTRO_SUITE_TIMEOUT without completing (#41)"
    fi
    return "$status"
  fi
  npm run "$@"
}
