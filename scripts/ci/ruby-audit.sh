#!/usr/bin/env bash
set -euo pipefail

# Keep the React Native CocoaPods bundle covered by the repo's security gate.
# The daily dependency audit enumerates Gemfile.lock files as Ruby ecosystems;
# this makes that coverage explicit rather than relying on the npm-only audit.
lockfile="examples/react-native-demo/Gemfile.lock"

if ! command -v bundle-audit >/dev/null 2>&1; then
  gem install bundler-audit --no-document
fi

bundle-audit check --update --gemfile-lock "$lockfile"
