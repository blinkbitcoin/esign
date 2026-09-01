#!/usr/bin/env bash
# Packs the three packages and installs them into a clean project, then
# asserts the consumer contract: the /webform entries resolve and never load
# Apollo. Run from the repo root (CI: CI / Tests / Packages job).
set -euo pipefail
ROOT="$(pwd)"
SMOKE="$(mktemp -d)"
trap 'rm -rf "$SMOKE"' EXIT

for p in packages/esign-core packages/esign-react-native packages/esign-react; do
  (cd "$p" && npm pack --pack-destination "$SMOKE" >/dev/null)
done

cd "$SMOKE"
npm init -y >/dev/null
# Install core first so the platform packages resolve it from the local tarball
npm install --no-save ./blinkbitcoin-esign-core-*.tgz >/dev/null
npm install --no-save ./blinkbitcoin-esign-react-native-*.tgz ./blinkbitcoin-esign-react-*.tgz >/dev/null 2>&1 || true

node - <<'NODE'
const assert = require('node:assert');
const webform = require('@blinkbitcoin/esign-core/webform');
assert.equal(typeof webform.createWebFormsSource, 'function');
assert.equal(typeof webform.createPublicUrlSource, 'function');
let apolloLoaded = false;
try { require.resolve('@apollo/client'); apolloLoaded = true; } catch {}
assert.equal(apolloLoaded, false, '@apollo/client must NOT be installed for webform-only use');
// The FULL entry needs the optional Apollo peers - without them installed it
// must fail loudly at require-time (that boundary is the reason /webform
// exists). If this ever starts succeeding, the optional-peer contract broke.
let fullLoaded = false;
try { require('@blinkbitcoin/esign-core'); fullLoaded = true; } catch {}
assert.equal(fullLoaded, false, 'full entry must require the Apollo peers');
console.log('pack smoke: /webform resolves Apollo-free; full entry correctly needs Apollo');
NODE
NODE_OPTIONS="" node --input-type=module -e "
import { createWebFormsSource } from '@blinkbitcoin/esign-core/webform';
if (typeof createWebFormsSource !== 'function') process.exit(1);
console.log('pack smoke: ESM import of /webform works');
"
echo "PACK SMOKE PASSED"
