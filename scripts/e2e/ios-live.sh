#!/usr/bin/env bash
# The React Native live run against real DocuSign: the service on the
# DocuSign provider, a Metro bundled for webform mode against it with the
# fixture form's prefill, and the Maestro flow that drives the real Web Form
# inside the demo's WebView to a signed envelope (.maestro/webform-live.yaml).
# Needs a booted iOS simulator with the demo app installed (make ios-build)
# and no Metro on :8081. Local only.
#   make e2e-ios-live [LIVE_PORT=4010]
set -euo pipefail
cd "$(dirname "$0")/../.."
# shellcheck source=scripts/e2e/live-service.sh
. scripts/e2e/live-service.sh
live_env
export PATH="$HOME/.maestro/bin:$PATH"
RN=examples/react-native-demo
APP_ID=org.reactjs.native.example.ReactNativeSandbox
METRO_LOG="${RUNNER_TEMP:-/tmp}/esign-metro-live.log"

# The booted simulator that has the demo installed (several may be booted;
# Maestro would otherwise pick one at random). MAESTRO_DEVICE overrides.
if [ -z "${MAESTRO_DEVICE:-}" ]; then
  for udid in $(xcrun simctl list devices booted | grep -o '[0-9A-F-]\{36\}'); do
    if xcrun simctl get_app_container "$udid" "$APP_ID" > /dev/null 2>&1; then
      MAESTRO_DEVICE=$udid; break
    fi
  done
fi
[ -n "${MAESTRO_DEVICE:-}" ] || { echo "::error::no booted simulator has $APP_ID installed (make ios-build, then boot it)"; exit 1; }
echo "== simulator $MAESTRO_DEVICE"

if lsof -t -iTCP:8081 -sTCP:LISTEN > /dev/null 2>&1; then
  echo "::error::port 8081 is taken - stop that Metro first (its bundle would not carry ESIGN_*)"; exit 1
fi

stop_all() {
  lsof -t -iTCP:8081 -sTCP:LISTEN 2>/dev/null | xargs kill 2>/dev/null || true
  kill "${METRO_PID:-}" 2>/dev/null || true
  live_service_down
}
trap stop_all EXIT
live_service_up

# ESIGN_* are inlined into the bundle (examples/react-native-demo/babel.config.js):
# webform mode, the live service's port, the fixture form's prefill
echo "== metro (webform mode, backend :$LIVE_PORT, live prefill)"
( cd "$RN" && ESIGN_MODE=webform ESIGN_BACKEND_PORT="$LIVE_PORT" ESIGN_PREFILL="$E2E_LIVE_PREFILL" npm start -- --reset-cache > "$METRO_LOG" 2>&1 ) &
METRO_PID=$!
metro_running() { curl -fsS http://127.0.0.1:8081/status 2> /dev/null | grep -q running; }
wait_for Metro 60 1 "$METRO_LOG" metro_running

# A cold launch through simctl, not Maestro: the running app must load the
# bundle from THIS Metro (ESIGN_*), and Maestro's iOS driver misreads a
# terminate->relaunch of its own as a crash (see .maestro/config.yaml)
echo "== relaunch the app on the simulator"
xcrun simctl terminate "$MAESTRO_DEVICE" "$APP_ID" > /dev/null 2>&1 || true
xcrun simctl launch "$MAESTRO_DEVICE" "$APP_ID" > /dev/null
sleep 5

echo "== maestro: the real form in the WebView, submitted and signed"
( cd "$RN" && maestro --device "$MAESTRO_DEVICE" test -e APP_ID="$APP_ID" .maestro/webform-live.yaml )
echo "ios live run: all ok"
