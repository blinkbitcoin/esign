#!/usr/bin/env bash
# Debug build of the RN demo for an emulator (what CI's Build Android job
# runs). Builds ONE ABI: the attached emulator's when one is running, else
# ANDROID_ABI, else x86_64 (the CI emulator) - gradle.properties lists all
# four and each is a separate native build of the app's glue.
# Output: examples/react-native-demo/android/app/build/outputs/apk/debug/app-debug.apk
#   make android-build [ANDROID_ABI=arm64-v8a]
set -euo pipefail
cd "$(dirname "$0")/../../examples/react-native-demo/android"
abi="${ANDROID_ABI:-}"
if [ -z "$abi" ] && command -v adb > /dev/null 2>&1; then
  abi="$(adb shell getprop ro.product.cpu.abi 2>/dev/null | tr -d '\r' || true)"
fi
abi="${abi:-x86_64}"
echo "android-build: assembleDebug for $abi"
./gradlew assembleDebug --no-daemon --build-cache -PreactNativeArchitectures="$abi"
