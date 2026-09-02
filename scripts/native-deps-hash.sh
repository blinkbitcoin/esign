#!/usr/bin/env bash
# Hash of every demo dependency the native (Gradle / Xcode) build consumes:
# the demo's runtime deps (react-native itself pins the Gradle plugin, Hermes
# and codegen; the rest are autolinked native modules) plus its @react-native/*
# and @react-native-community/* dev deps (the CLI that autolinking runs, the
# platform plugins, the metro/babel presets codegen uses). Pure JS tooling
# (jest, babel, typescript, @types) is deliberately left out.
#
# Reads only package-lock.json so it can run before `npm ci`. Part of the
# APK / .app cache keys in .github/workflows/e2e.yml.
set -euo pipefail
cd "$(dirname "$0")/.."

jq -r --slurpfile demo examples/react-native-demo/package.json '
  . as $root
  | ($demo[0].dependencies
     + ($demo[0].devDependencies
        | with_entries(select(.key | test("^@react-native(-community)?/")))))
  | keys[] as $d
  | ($root.packages["node_modules/\($d)"]
     // error("\($d) is not in package-lock.json"))
  | "\($d)@\(if .link then "link:" + .resolved else .version end)"
' package-lock.json | sort | shasum -a 256 | cut -c1-16
