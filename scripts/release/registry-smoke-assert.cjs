// Consumer-contract assertions for registry-smoke.sh, run from inside the
// freshly installed project. CommonJS on purpose: the contract is about
// `require` resolution and require.cache.
//   default : /webform must load without pulling Apollo or graphql into the cache
//   lean    : an --omit=peer install must not contain Apollo at all
//   server  : esign-node and esign-service carry the published version, and
//             the service's dependency on the Node package resolves to that
//             same version (the release stamp, seen from a consumer)
const assert = require('node:assert');
const path = require('node:path');
const { createRequire } = require('node:module');

// Resolve the installed packages from the smoke project (cwd), not from this
// file's location in the repo checkout, which has no node_modules for them.
const consumer = createRequire(path.join(process.cwd(), 'package.json'));

// A package's published manifest, read through the resolver that would find
// it at runtime. `from` is a require function rooted where the lookup starts.
const manifestOf = (from, name) =>
  require(from.resolve(`${name}/package.json`));

const mode = process.argv[2];
if (mode === 'default') {
  const webform = consumer('@blinkbitcoin/esign-core/webform');
  assert.equal(typeof webform.createWebFormsSource, 'function');
  assert.equal(typeof webform.createPublicUrlSource, 'function');
  const loaded = Object.keys(require.cache).filter(f =>
    /node_modules[\\/](@apollo|graphql)/.test(f),
  );
  assert.deepEqual(loaded, [], '/webform must not load Apollo or graphql');
  console.log('verify: /webform loads Apollo-free for', process.env.VERSION);
} else if (mode === 'lean') {
  consumer('@blinkbitcoin/esign-core/webform');
  let apollo = false;
  try {
    consumer.resolve('@apollo/client');
    apollo = true;
  } catch {}
  assert.equal(apollo, false, '--omit=peer install must not contain Apollo');
  console.log('verify: --omit=peer install is Apollo-free');
} else if (mode === 'server') {
  const version = process.env.VERSION;
  const node = manifestOf(consumer, '@blinkbitcoin/esign-node');
  const service = manifestOf(consumer, '@blinkbitcoin/esign-service');
  assert.equal(node.version, version, 'esign-node was published unstamped');
  assert.equal(
    service.version,
    version,
    'esign-service was published unstamped',
  );

  // The range the service asks the registry for. An unstamped service keeps
  // the workspace placeholder and npm resolves a version nobody published.
  assert.equal(
    service.dependencies['@blinkbitcoin/esign-node'],
    version,
    'esign-service does not depend on esign-node at the published version',
  );

  // ...and what it actually got, resolved from the service's own directory
  const fromService = createRequire(
    consumer.resolve('@blinkbitcoin/esign-service/package.json'),
  );
  assert.equal(
    manifestOf(fromService, '@blinkbitcoin/esign-node').version,
    version,
    'the esign-node the service resolves is not the published version',
  );

  // The Node package's public entry loads from the registry tarball. The
  // service's own entry is a process bootstrap, so it is never required here.
  const server = consumer('@blinkbitcoin/esign-node');
  assert.equal(typeof server.createWebFormInstance, 'function');
  console.log('verify: the server packages install stamped at', version);
} else {
  console.error('usage: registry-smoke-assert.cjs <default|lean|server>');
  process.exit(2);
}
