#!/usr/bin/env bash
# Consumes what was ACTUALLY published: installs the exact version from the
# registry into two clean projects and asserts the consumer contract.
# GitHub Packages strips `peerDependenciesMeta` from the metadata npm builds
# its tree from, so npm installs the optional Apollo peer as if required.
# Nothing in the tarball can change that (pack-smoke.sh proves the tarball is
# right), so the contract asserted is the one the registry can deliver:
#   1. a default install never LOADS Apollo through /webform
#   2. `--omit=peer` yields the documented Apollo-free install
# Usage: registry-smoke.sh <version>. Needs npm configured for the
# @blinkbitcoin scope (setup-node registry-url in CI; ~/.npmrc locally).
# CI: Verify job. Local: make registry-smoke V=<version>
set -euo pipefail
VERSION="${1:?usage: registry-smoke.sh <version>}"
ASSERT="$(cd "$(dirname "$0")" && pwd)/registry-smoke-assert.cjs"
WORK=$(mktemp -d)

echo "--- npm $(npm -v) / node $(node -v)"
mkdir "$WORK/smoke" && cd "$WORK/smoke"
npm init -y > /dev/null
npm install "@blinkbitcoin/esign-core@$VERSION" > /dev/null
echo "--- published manifest peer metadata:"
node -p "JSON.stringify(require('@blinkbitcoin/esign-core/package.json').peerDependenciesMeta ?? 'MISSING')"
echo "--- @apollo/client in the tree (expected: yes, registry drops peerDependenciesMeta):"
npm why @apollo/client || echo "(not installed)"
VERSION="$VERSION" node "$ASSERT" default

mkdir "$WORK/smoke-lean" && cd "$WORK/smoke-lean"
npm init -y > /dev/null
npm install --omit=peer "@blinkbitcoin/esign-core@$VERSION" > /dev/null
VERSION="$VERSION" node "$ASSERT" lean
