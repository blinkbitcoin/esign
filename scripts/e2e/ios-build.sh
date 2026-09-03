#!/usr/bin/env bash
# Debug build of the RN demo for the simulator. Generic destination on
# purpose: the build needs no concrete device (the app is installed on the
# booted one later), and xcodebuild's device enumeration intermittently
# returns only placeholders on fresh runners. Needs pods installed (make pods).
# Output: examples/react-native-demo/ios/build/Build/Products/Debug-iphonesimulator/ReactNativeSandbox.app
set -euo pipefail
cd "$(dirname "$0")/../../examples/react-native-demo/ios"
xcodebuild \
  -workspace ReactNativeSandbox.xcworkspace \
  -scheme ReactNativeSandbox \
  -configuration Debug \
  -sdk iphonesimulator \
  -destination "generic/platform=iOS Simulator" \
  -derivedDataPath build \
  build
