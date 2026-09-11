#!/usr/bin/env bash
# The React Native demo on a physical iPhone against real DocuSign, in one
# command: the .env, a public URL, the service on the DocuSign provider,
# Metro carrying the mode and the Mac's tailnet address (ESIGN_BACKEND_HOST),
# the app built and launched on the attached phone - then it waits for
# docs/integration/docusign-proxy.md section 5 (row 6: the real Web Form in
# a plain WebView, ESIGN_MODE=webform) and tears down on Ctrl-C.
#   make live-ios [ESIGN_MODE=proxy|webform] [LIVE_DEVICE="<name>"] [ESIGN_BACKEND_HOST=<ip>]
# First time on a phone: pick the signing team for ReactNativeSandbox in Xcode.
# The automated simulator counterpart is ios-live.sh (make e2e-ios-live).
set -euo pipefail
cd "$(dirname "$0")/../.."
# shellcheck source=scripts/e2e/live-service.sh
. scripts/e2e/live-service.sh
# shellcheck source=scripts/e2e/xcode-env.sh
. scripts/e2e/xcode-env.sh
live_env
trap live_stack_down EXIT
trap 'exit 130' INT TERM # the EXIT trap tears down once
RN=examples/react-native-demo
LOG_DIR="${RUNNER_TEMP:-/tmp}"

# The phone reaches the Mac over the tailnet (else give ESIGN_BACKEND_HOST=<LAN ip>)
ESIGN_BACKEND_HOST="${ESIGN_BACKEND_HOST:-$(tailscale ip -4 2> /dev/null | head -1)}"
[ -n "$ESIGN_BACKEND_HOST" ] || { echo "::error::ESIGN_BACKEND_HOST: no tailnet address - pass the Mac's LAN ip"; exit 1; }
# The first attached physical iPhone unless LIVE_DEVICE names one (the name
# Xcode shows, e.g. "jonas-iphone": react-native run-ios --device takes a name)
IOS_DEVICE="${LIVE_DEVICE:-$(/usr/bin/xcrun xctrace list devices 2> /dev/null | grep -E '^[^=].*\(' | grep -viE 'simulator|macbook|mac |ipad' | head -1 | sed -E 's/ \([^)]*\)( \([^)]*\))?$//')}"
[ -n "$IOS_DEVICE" ] || { echo "::error::no iPhone attached (xcrun xctrace list devices)"; exit 1; }
ESIGN_MODE="${ESIGN_MODE:-proxy}"
if lsof -t -iTCP:8081 -sTCP:LISTEN > /dev/null 2>&1; then
  echo "::error::port 8081 is taken - stop that Metro first (its bundle would not carry ESIGN_*)"; exit 1
fi

live_public_url
# The signing WebView follows DocuSign's redirect to the return URL: the
# funnel when up, else the service on the tailnet address
live_service_up DOCUSIGN_RETURN_URL="${PUBLIC_BASE_URL:-http://$ESIGN_BACKEND_HOST:$LIVE_PORT}/signing/return"

echo "== Metro ($ESIGN_MODE mode, service at $ESIGN_BACKEND_HOST:$LIVE_PORT)"
( cd "$RN" && ESIGN_MODE="$ESIGN_MODE" ESIGN_BACKEND_HOST="$ESIGN_BACKEND_HOST" ESIGN_BACKEND_PORT="$LIVE_PORT" ESIGN_PREFILL="$E2E_LIVE_PREFILL" npm start -- --reset-cache > "$LOG_DIR/metro-live.log" 2>&1 ) &
bash scripts/e2e/metro-wait.sh ios

echo "== build + launch on \"$IOS_DEVICE\""
( cd "$RN" && npm run ios -- --device "$IOS_DEVICE" > "$LOG_DIR/ios-live.log" 2>&1 ) || { tail -30 "$LOG_DIR/ios-live.log"; echo "::error::the device build failed (full log: $LOG_DIR/ios-live.log; first time: select the signing team in Xcode)"; exit 1; }
echo
echo "app   running on \"$IOS_DEVICE\" ($ESIGN_MODE mode) - docs/integration/docusign-proxy.md section 5"
echo "logs  $LOG (return-URL events, webhook outcomes)  $LOG_DIR/metro-live.log (onMessage traffic)  $LOG_DIR/ios-live.log"
echo "Ctrl-C tears it down (the funnel stays: tailscale funnel --https=443 off)"
wait
