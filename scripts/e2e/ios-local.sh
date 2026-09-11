#!/usr/bin/env bash
# The whole iOS E2E stack on a laptop, in one command, torn down on the way
# out whatever happens: E2E Postgres + migrations, the backend (mock
# provider) on ESIGN_API_PORT, pods when missing, the debug .app for the host
# architecture, a booted simulator (the booted one, else the first iPhone),
# the app installed on it, Metro in proxy mode, the Maestro suite. Needs:
# Xcode, Maestro. CI runs the same steps as separate jobs (e2e.yml).
#   make e2e-ios-local
set -euo pipefail
cd "$(dirname "$0")/../.."
# shellcheck source=scripts/e2e/ports-env.sh
. scripts/e2e/ports-env.sh
# shellcheck source=scripts/e2e/xcode-env.sh
. scripts/e2e/xcode-env.sh
command -v maestro > /dev/null 2>&1 || [ -x "$HOME/.maestro/bin/maestro" ] || { echo "::error::maestro is not installed: curl -Ls https://get.maestro.mobile.dev | bash"; exit 1; }
APP=examples/react-native-demo/ios/build/Build/Products/Debug-iphonesimulator/ReactNativeSandbox.app

down() {
  echo "== teardown"
  bash scripts/e2e/metro-down.sh
  bash scripts/e2e/backend-down.sh
  make test-db-down > /dev/null 2>&1 || true
}
trap down EXIT

echo "== simulator"
if ! /usr/bin/xcrun simctl list devices booted | grep -q "(Booted)"; then
  bash scripts/e2e/ios-simulator.sh pick
fi
echo "== test database"
make test-db-up > /dev/null
npm run --silent migrate:test -w packages/esign-service > /dev/null
echo "== backend (mock provider) on :$ESIGN_API_PORT"
bash scripts/e2e/backend-up.sh
echo "== debug .app"
# Pods are installed when missing or stale (Manifest.lock is what pod install
# last wrote; Xcode makes the same comparison)
diff -q examples/react-native-demo/ios/Podfile.lock examples/react-native-demo/ios/Pods/Manifest.lock > /dev/null 2>&1 || make pods
bash scripts/e2e/ios-build.sh > "${RUNNER_TEMP:-/tmp}/ios-build.log" 2>&1 || { tail -40 "${RUNNER_TEMP:-/tmp}/ios-build.log"; echo "::error::ios-build failed (full log: ${RUNNER_TEMP:-/tmp}/ios-build.log)"; exit 1; }
/usr/bin/xcrun simctl bootstatus booted -b > /dev/null
bash scripts/e2e/ios-simulator.sh install "$APP"
echo "== Metro (proxy mode)"
bash scripts/e2e/metro-start.sh
bash scripts/e2e/metro-wait.sh ios
echo "== Maestro"
bash scripts/e2e/ios-maestro.sh
echo "ios e2e: all ok"
