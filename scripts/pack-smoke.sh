#!/usr/bin/env bash
# Packs the five packages and installs the four client/server libraries into
# a clean project, then asserts the consumer contract: the /docusign +
# /webform entries resolve and never load Apollo, and the Node package loads
# on plain Node. The service package has no library entry points to assert
# against (it is an app); packing it here still proves the tarball builds.
# Run from the repo root after `npm run build` (CI: E2E / Build Packages).
set -euo pipefail
SMOKE="$(mktemp -d)"
trap 'rm -rf "$SMOKE"' EXIT

for p in packages/esign-core packages/esign-node packages/esign-react-native packages/esign-react packages/esign-service; do
  (cd "$p" && npm pack --pack-destination "$SMOKE" >/dev/null)
done

cd "$SMOKE"
npm init -y >/dev/null
# Install core first so the platform packages resolve it from the local tarball
npm install --no-save --prefer-offline --no-audit ./blinkbitcoin-esign-core-*.tgz >/dev/null
# (--no-save installs are pruned by the next install unless still needed, so
#  the Node package rides along with the platform packages here)
npm install --no-save --prefer-offline --no-audit ./blinkbitcoin-esign-react-native-*.tgz ./blinkbitcoin-esign-react-*.tgz ./blinkbitcoin-esign-node-*.tgz >/dev/null 2>&1 || true

node - <<'NODE'
const assert = require('node:assert');
const webform = require('@blinkbitcoin/esign-core/webform');
assert.equal(typeof webform.createWebFormsSource, 'function');
assert.equal(typeof webform.createPublicUrlSource, 'function');
assert.equal(typeof webform.createHostedFormSource, 'function');
// /docusign is the canonical DocuSign entry; /webform its alias
const docusign = require('@blinkbitcoin/esign-core/docusign');
assert.equal(typeof docusign.createWebFormsSource, 'function');
assert.equal(typeof docusign.interpretDocuSignEvent, 'function');
assert.equal(typeof docusign.createHostedFormSource, 'function');
let apolloLoaded = false;
try { require.resolve('@apollo/client'); apolloLoaded = true; } catch {}
assert.equal(apolloLoaded, false, '@apollo/client must NOT be installed for webform-only use');
// The FULL entry needs the optional Apollo peers - without them installed it
// must fail loudly at require-time (that boundary is the reason /webform
// exists). If this ever starts succeeding, the optional-peer contract broke.
let fullLoaded = false;
try { require('@blinkbitcoin/esign-core'); fullLoaded = true; } catch {}
assert.equal(fullLoaded, false, 'full entry must require the Apollo peers');
console.log('pack smoke: /docusign + /webform resolve Apollo-free; full entry correctly needs Apollo');
// The RN package's subpaths resolve through its export map to bob's output
// (not loaded: that needs react-native)
for (const sub of ['webform', 'docusign']) {
  assert.match(require.resolve(`@blinkbitcoin/esign-react-native/${sub}`), new RegExp(`lib/commonjs/${sub}\\.js$`));
}
console.log('pack smoke: esign-react-native /webform + /docusign resolve');
// The web package's /docusign subpath resolves through its export map
// (not loaded: the component needs react)
assert.match(require.resolve('@blinkbitcoin/esign-react/docusign'), /dist\/docusign\.cjs$/);
console.log('pack smoke: esign-react /docusign resolves');
// The Node package: CJS entry loads on plain Node with no peers at all
const server = require('@blinkbitcoin/esign-node');
assert.equal(typeof server.createWebFormInstance, 'function');
assert.equal(typeof server.createDocuSignClient, 'function');
assert.equal(typeof server.parseWebFormPrefill, 'function');
console.log('pack smoke: esign-node loads on plain Node');
assert.equal(typeof server.providerFromEnv, 'function');
assert.equal(typeof server.hostedFormMint, 'function');
// The /docusign subpath: the adapter on its own, no peers
const serverDocusign = require('@blinkbitcoin/esign-node/docusign');
assert.equal(typeof serverDocusign.createDocuSignClient, 'function');
assert.equal(typeof serverDocusign.createWebFormInstance, 'function');
assert.equal(typeof serverDocusign.mintFromDocuSign, 'function');
console.log('pack smoke: esign-node/docusign loads without peers; providerFromEnv on the root');
// The /express subpath needs the optional express peer: without it the
// require must fail loudly (the boundary that keeps the main entry framework-free)
let expressLoaded = false;
try { require('@blinkbitcoin/esign-node/express'); expressLoaded = true; } catch {}
assert.equal(expressLoaded, false, 'esign-node/express must require the express peer');
console.log('pack smoke: esign-node/express correctly needs express');
// The /knex subpath only types against knex: the host passes its own Knex
// instance, so the entry must load with no knex installed at all
const knexEntry = require('@blinkbitcoin/esign-node/knex');
assert.equal(typeof knexEntry.createKnexEnvelopeStore, 'function');
assert.equal(typeof knexEntry.runESignMigrations, 'function');
console.log('pack smoke: esign-node/knex loads without knex (host-provided instance)');
NODE
NODE_OPTIONS="" node --input-type=module -e "
import { createWebFormsSource } from '@blinkbitcoin/esign-core/webform';
import { createWebFormsSource as fromDocuSign } from '@blinkbitcoin/esign-core/docusign';
if (typeof createWebFormsSource !== 'function' || typeof fromDocuSign !== 'function') process.exit(1);
console.log('pack smoke: ESM import of /webform + /docusign works');
"
NODE_OPTIONS="" node --input-type=module -e "
import { createWebFormInstance } from '@blinkbitcoin/esign-node';
if (typeof createWebFormInstance !== 'function') process.exit(1);
console.log('pack smoke: ESM import of esign-node works');
"
NODE_OPTIONS="" node --input-type=module -e "
import { createDocuSignProvider } from '@blinkbitcoin/esign-node/docusign';
if (typeof createDocuSignProvider !== 'function') process.exit(1);
console.log('pack smoke: ESM import of esign-node/docusign works');
"
echo "PACK SMOKE PASSED"
