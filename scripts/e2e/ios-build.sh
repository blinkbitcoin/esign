#!/usr/bin/env bash
# Debug build of the RN demo for the simulator. Generic destination on
# purpose: the build needs no concrete device (the app is installed on the
# booted one later), and xcodebuild's device enumeration intermittently
# returns only placeholders on fresh runners. Needs pods installed (make pods).
# Output: examples/react-native-demo/ios/build/Build/Products/Debug-iphonesimulator/ReactNativeSandbox.app
set -euo pipefail
cd "$(dirname "$0")/../../examples/react-native-demo/ios"
# The generic simulator destination builds every simulator slice (arm64 and
# x86_64) unless told otherwise; the simulator that runs the app has the
# host's architecture, so build only that one. Override with IOS_SIM_ARCH.
IOS_SIM_ARCH="${IOS_SIM_ARCH:-$(uname -m)}"
xcodebuild \
  -workspace ReactNativeSandbox.xcworkspace \
  -scheme ReactNativeSandbox \
  -configuration Debug \
  -sdk iphonesimulator \
  -destination "generic/platform=iOS Simulator" \
  -derivedDataPath build \
  ARCHS="$IOS_SIM_ARCH" ONLY_ACTIVE_ARCH=YES \
  build
