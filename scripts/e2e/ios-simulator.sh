#!/usr/bin/env bash
# iOS simulator plumbing for the E2E job.
#   pick     boot the first available iPhone (runner images rotate
#            generations, so no hardcoded model); exports SIM_DEVICE to
#            $GITHUB_ENV when set, prints it otherwise
#   wait     block until $SIM_DEVICE finished booting
#   install  install the .app (tar from build-ios, or an existing .app dir)
# Usage: ios-simulator.sh pick | wait | install <app.tar|App.app>
set -euo pipefail
APP_DIR=examples/react-native-demo/ios/build/Build/Products/Debug-iphonesimulator
case "${1:-}" in
  pick)
    DEVICE_NAME=$(xcrun simctl list devices available -j \
      | jq -r '[.devices[] | .[] | select(.isAvailable and (.name | startswith("iPhone")))] | .[0].name')
    if [ -z "$DEVICE_NAME" ] || [ "$DEVICE_NAME" = "null" ]; then
      echo "::error::No available iPhone simulator on this machine"
      xcrun simctl list devices available; exit 1
    fi
    echo "Using simulator: $DEVICE_NAME"
    echo "SIM_DEVICE=$DEVICE_NAME" >> "${GITHUB_ENV:-/dev/null}"
    xcrun simctl boot "$DEVICE_NAME" || true
    ;;
  wait)
    xcrun simctl bootstatus "${SIM_DEVICE:?SIM_DEVICE not set - run 'pick' first}" -b
    ;;
  install)
    SRC="${2:?usage: ios-simulator.sh install <app.tar|App.app>}"
    if [ -d "$SRC" ]; then
      APP="$SRC"
    else
      mkdir -p "$APP_DIR"
      tar -C "$APP_DIR" -xf "$SRC"
      APP="$APP_DIR/ReactNativeSandbox.app"
    fi
    xcrun simctl install booted "$APP"
    ;;
  *) echo "usage: ios-simulator.sh pick | wait | install <app.tar|App.app>"; exit 2 ;;
esac
