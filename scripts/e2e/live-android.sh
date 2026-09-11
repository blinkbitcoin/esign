#!/usr/bin/env bash
# The React Native demo on the attached Android device against real
# DocuSign, in one command: the .env, a public URL, the service on the
# DocuSign provider, Metro carrying the mode, the debug APK for the device's
# ABI installed and launched - then it waits for docs/integration/
# docusign-proxy.md section 5 (row 6: the real Web Form in a plain WebView,
# ESIGN_MODE=webform) and tears down on Ctrl-C. The device reaches Metro and
# the service through `adb reverse` (USB), so ESIGN_BACKEND_HOST is localhost
# on the device; the return URL is the funnel when up, else that localhost.
#   make live-android [ESIGN_MODE=proxy|webform] [LIVE_DEVICE=<serial>]
# LIVE_DEVICE is the adb serial (adb devices); ANDROID_SERIAL, adb's own
# variable, is honoured too. An emulator works as well as a phone here.
set -euo pipefail
cd "$(dirname "$0")/../.."
# shellcheck source=scripts/e2e/live-service.sh
. scripts/e2e/live-service.sh
live_env
trap live_stack_down EXIT
trap 'exit 130' INT TERM # the EXIT trap tears down once
RN=examples/react-native-demo
LOG_DIR="${RUNNER_TEMP:-/tmp}"
adb get-state > /dev/null 2>&1 || { echo "::error::no Android device attached (adb devices) - plug the phone in with USB debugging on, or start an emulator"; exit 1; }
SERIAL="${LIVE_DEVICE:-${ANDROID_SERIAL:-$(adb get-serialno)}}"
ESIGN_MODE="${ESIGN_MODE:-proxy}"
if lsof -t -iTCP:8081 -sTCP:LISTEN > /dev/null 2>&1; then
  echo "::error::port 8081 is taken - stop that Metro first (its bundle would not carry ESIGN_*)"; exit 1
fi

live_public_url
live_service_up DOCUSIGN_RETURN_URL="${PUBLIC_BASE_URL:-http://localhost:$LIVE_PORT}/signing/return"

echo "== adb reverse (Metro 8081, service $LIVE_PORT) on $SERIAL"
adb -s "$SERIAL" reverse tcp:8081 tcp:8081
adb -s "$SERIAL" reverse "tcp:$LIVE_PORT" "tcp:$LIVE_PORT"

echo "== Metro ($ESIGN_MODE mode, service at localhost:$LIVE_PORT through adb reverse)"
( cd "$RN" && ESIGN_MODE="$ESIGN_MODE" ESIGN_BACKEND_HOST=localhost ESIGN_BACKEND_PORT="$LIVE_PORT" ESIGN_PREFILL="$E2E_LIVE_PREFILL" npm start -- --reset-cache > "$LOG_DIR/metro-live.log" 2>&1 ) &
bash scripts/e2e/metro-wait.sh android

echo "== debug APK for $SERIAL, installed and launched"
ANDROID_ABI="$(adb -s "$SERIAL" shell getprop ro.product.cpu.abi | tr -d '\r')" bash scripts/e2e/android-build.sh > "$LOG_DIR/android-live.log" 2>&1 || { tail -30 "$LOG_DIR/android-live.log"; echo "::error::the APK build failed (full log: $LOG_DIR/android-live.log)"; exit 1; }
adb -s "$SERIAL" install -r "$RN/android/app/build/outputs/apk/debug/app-debug.apk" > /dev/null
adb -s "$SERIAL" shell am start -n com.reactnativesandbox/.MainActivity > /dev/null
echo
echo "app   running on $SERIAL ($ESIGN_MODE mode) - docs/integration/docusign-proxy.md section 5"
echo "logs  $LOG (return-URL events, webhook outcomes)  $LOG_DIR/metro-live.log (onMessage traffic)  adb logcat"
echo "Ctrl-C tears it down (the funnel stays: tailscale funnel --https=443 off)"
wait
