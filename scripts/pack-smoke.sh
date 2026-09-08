#!/usr/bin/env bash
# Packs the four packages and installs them into a clean project, then
# asserts the consumer contract: the /webform entries resolve and never load
# Apollo, and the server package loads on plain Node. Run from the repo root after `npm run build` (CI: E2E / Build Packages).
set -euo pipefail
SMOKE="$(mktemp -d)"
trap 'rm -rf "$SMOKE"' EXIT

for p in packages/esign-core packages/esign-server packages/esign-react-native packages/esign-react; do
  (cd "$p" && npm pack --pack-destination "$SMOKE" >/dev/null)
done

cd "$SMOKE"
npm init -y >/dev/null
# Install core first so the platform packages resolve it from the local tarball
npm install --no-save --prefer-offline --no-audit ./blinkbitcoin-esign-core-*.tgz >/dev/null
# (--no-save installs are pruned by the next install unless still needed, so
#  the server package rides along with the platform packages here)
npm install --no-save --prefer-offline --no-audit ./blinkbitcoin-esign-react-native-*.tgz ./blinkbitcoin-esign-react-*.tgz ./blinkbitcoin-esign-server-*.tgz >/dev/null 2>&1 || true

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
// The server package: CJS entry loads on plain Node with no peers at all
const server = require('@blinkbitcoin/esign-server');
assert.equal(typeof server.createWebFormInstance, 'function');
assert.equal(typeof server.createDocuSignClient, 'function');
assert.equal(typeof server.parseWebFormPrefill, 'function');
console.log('pack smoke: esign-server loads on plain Node');
NODE
NODE_OPTIONS="" node --input-type=module -e "
import { createWebFormsSource } from '@blinkbitcoin/esign-core/webform';
if (typeof createWebFormsSource !== 'function') process.exit(1);
console.log('pack smoke: ESM import of /webform works');
"
NODE_OPTIONS="" node --input-type=module -e "
import { createWebFormInstance } from '@blinkbitcoin/esign-server';
if (typeof createWebFormInstance !== 'function') process.exit(1);
console.log('pack smoke: ESM import of esign-server works');
"
echo "PACK SMOKE PASSED"
