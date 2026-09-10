#!/usr/bin/env bash
# Maestro E2E on the booted iOS simulator (webform-tagged flows excluded -
# they need an ESIGN_MODE=webform Metro). Needs: app installed, Metro +
# backend running. Each flow retries itself once (see the `retry` blocks in
# .maestro/): Maestro's iOS driver misreads a slow terminate->relaunch cycle
# as an app crash (no real crash - DiagnosticReports stays empty). The
# suite-level retry here is the last resort, not the expected path.
# CI: E2E / iOS. Local: make e2e-ios.
set -uo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
cd "$HERE/../.." || exit 1
export PATH="$HOME/.maestro/bin:$PATH"
# shellcheck source=scripts/e2e/maestro-bound.sh
. "$HERE/maestro-bound.sh"
# shellcheck source=scripts/e2e/xcode-env.sh
. "$HERE/xcode-env.sh"
# The booted simulator, by UDID: with an Android emulator up as well (a
# laptop, not CI) Maestro would otherwise pick whichever device it lists
# first and look for the iOS bundle id on Android. The demo's test:e2e
# script appends --device from this variable (an argument would be eaten
# by the two npm layers in between).
UDID=$(/usr/bin/xcrun simctl list devices booted -j | jq -r '[.devices[][] | select(.state == "Booted")][0].udid')
[ -n "$UDID" ] && [ "$UDID" != "null" ] || { echo "::error::no booted iOS simulator (make e2e-ios-local boots one)"; exit 1; }
export MAESTRO_DEVICE="$UDID"
# Bounded per attempt (see maestro-bound.sh); a hung driver is not retried -
# the second attempt would only run into the step's timeout-minutes.
bounded_maestro test:e2e || {
  status=$?
  [ "$status" -eq 124 ] && exit "$status"
  echo "::warning::Maestro suite failed after per-flow retries - rerunning the suite once"
  bounded_maestro test:e2e
}
