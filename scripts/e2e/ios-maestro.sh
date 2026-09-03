#!/usr/bin/env bash
# Maestro E2E on the booted iOS simulator (webform-tagged flows excluded -
# they need an ESIGN_MODE=webform Metro). Needs: app installed, Metro +
# backend running. Each flow retries itself once (see the `retry` blocks in
# .maestro/): Maestro's iOS driver misreads a slow terminate->relaunch cycle
# as an app crash (no real crash - DiagnosticReports stays empty). The
# suite-level retry here is the last resort, not the expected path.
# CI: E2E / iOS. Local: make e2e-ios.
set -uo pipefail
cd "$(dirname "$0")/../.." || exit 1
export PATH="$HOME/.maestro/bin:$PATH"
npm run test:e2e || {
  echo "::warning::Maestro suite failed after per-flow retries - rerunning the suite once"
  npm run test:e2e
}
