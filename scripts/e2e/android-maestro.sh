#!/usr/bin/env bash
# Maestro E2E on a running Android emulator: installs the debug APK, wires
# Metro (8081) and the backend (4000) into the emulator via adb reverse (the
# signing WebView loads localhost:4000 URLs minted by the mock provider), runs
# the suite and keeps device forensics (logcat) when it fails.
# Needs: emulator up, debug APK built, Metro + backend running (metro-start.sh,
# backend-up.sh). CI: the `script:` input of reactivecircus/android-emulator-
# runner, which executes each line as its own `sh -c` - hence a file, not
# inline shell. Local: make e2e-android.
set -uo pipefail

APK=examples/react-native-demo/android/app/build/outputs/apk/debug/app-debug.apk
LOGS="${RUNNER_TEMP:-/tmp}/android-logs"

adb install "$APK"
# Metro + backend: the signing WebView loads localhost:4000 URLs minted by
# the mock provider - reverse both into the emulator.
adb reverse tcp:8081 tcp:8081
adb reverse tcp:4000 tcp:4000
# A starved CI emulator throws "X isn't responding" dialogs (even for the
# launcher) on top of the app under test, which then fails visibility
# assertions. Hide ANR/crash dialogs; real crashes still land in logcat.
adb shell settings put global hide_error_dialogs 1
export PATH="$HOME/.maestro/bin:$PATH"

# The default 256K main buffer wraps within a couple of minutes on the
# emulator, losing the app-launch window from the post-mortem dump.
adb logcat -G 64M
adb logcat -c
status=0
npm run test:e2e:android -w examples/react-native-demo || status=$?

# Forensics: the failure screenshots show the launcher (the app process is
# gone after a WebView teardown), so keep the device log for the post-mortem.
mkdir -p "$LOGS"
adb logcat -d > "$LOGS/logcat.txt" || true
adb logcat -d -b crash > "$LOGS/logcat-crash.txt" || true
if [ "$status" -ne 0 ]; then
  echo "::group::logcat crash buffer"
  cat "$LOGS/logcat-crash.txt"
  echo "::endgroup::"
  echo "::group::logcat: app process lifecycle + WebView (last 200 lines)"
  grep -aiE 'reactnativesandbox|RNCWebView|ReactNativeJS|chromium|cr_|AndroidRuntime|FATAL|Fatal signal|lowmemorykiller|has died|app died' \
    "$LOGS/logcat.txt" | tail -200
  echo "::endgroup::"
fi
exit "$status"
