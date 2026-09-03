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
# Bounded per attempt (see maestro-bound.sh); a hung driver is not retried -
# the second attempt would only run into the step's timeout-minutes.
bounded_maestro test:e2e || {
  status=$?
  [ "$status" -eq 124 ] && exit "$status"
  echo "::warning::Maestro suite failed after per-flow retries - rerunning the suite once"
  bounded_maestro test:e2e
}
