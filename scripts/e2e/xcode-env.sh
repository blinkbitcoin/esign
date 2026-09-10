#!/usr/bin/env bash
# Sourced before xcodebuild / xcrun: the nix dev shell (direnv, flake.nix)
# exports its own Apple SDK and clang wrapper - DEVELOPER_DIR, SDKROOT, CC,
# CXX, the NIX_* flags - which xcodebuild would otherwise honour and fail
# with "unknown argument: -index-store-path" against the macOS 14 SDK. The
# iOS build wants the Xcode toolchain (xcode-select); node for React
# Native's build phases comes from ios/.xcode.env.local, which flake.nix
# writes. The nix Apple SDK also puts its own `xcrun` on PATH, so the
# scripts call /usr/bin/xcrun and /usr/bin/xcodebuild by path.
unset DEVELOPER_DIR SDKROOT MACOSX_DEPLOYMENT_TARGET
unset CC CXX CPP LD AR AS NM RANLIB STRIP OBJC OBJCXX
unset NIX_CC NIX_BINTOOLS NIX_CFLAGS_COMPILE NIX_LDFLAGS NIX_HARDENING_ENABLE \
  NIX_APPLE_SDK_VERSION NIX_ENFORCE_NO_NATIVE NIX_IGNORE_LD_THROUGH_GCC \
  NIX_DONT_SET_RPATH NIX_DONT_SET_RPATH_FOR_BUILD NIX_NO_SELF_RPATH
# Maestro and Xcode's own scripts call `xcrun` through PATH, where the nix
# Apple SDK's xcbuild shim comes first and answers "unable to find sdk". A
# two-entry bin dir with Apple's xcrun and xcodebuild goes in front; nothing
# else on PATH (node, ruby, bundle) changes.
XCODE_BIN="${TMPDIR:-/tmp}/kyc-xcode-bin"
mkdir -p "$XCODE_BIN"
ln -sf /usr/bin/xcrun "$XCODE_BIN/xcrun"
ln -sf /usr/bin/xcodebuild "$XCODE_BIN/xcodebuild"
export PATH="$XCODE_BIN:$PATH"
