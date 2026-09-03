// Consumer-contract assertions for registry-smoke.sh, run from inside the
// freshly installed project. CommonJS on purpose: the contract is about
// `require` resolution and require.cache.
//   default : /webform must load without pulling Apollo or graphql into the cache
//   lean    : an --omit=peer install must not contain Apollo at all
const assert = require('node:assert');
const path = require('node:path');
const { createRequire } = require('node:module');

// Resolve the installed packages from the smoke project (cwd), not from this
// file's location in the repo checkout, which has no node_modules for them.
const consumer = createRequire(path.join(process.cwd(), 'package.json'));

const mode = process.argv[2];
if (mode === 'default') {
  const webform = consumer('@blinkbitcoin/esign-core/webform');
  assert.equal(typeof webform.createWebFormsSource, 'function');
  assert.equal(typeof webform.createPublicUrlSource, 'function');
  const loaded = Object.keys(require.cache).filter((f) => /node_modules[\\/](@apollo|graphql)/.test(f));
  assert.deepEqual(loaded, [], '/webform must not load Apollo or graphql');
  console.log('verify: /webform loads Apollo-free for', process.env.VERSION);
} else if (mode === 'lean') {
  consumer('@blinkbitcoin/esign-core/webform');
  let apollo = false;
  try { consumer.resolve('@apollo/client'); apollo = true; } catch {}
  assert.equal(apollo, false, '--omit=peer install must not contain Apollo');
  console.log('verify: --omit=peer install is Apollo-free');
} else {
  console.error('usage: registry-smoke-assert.cjs <default|lean>');
  process.exit(2);
}
