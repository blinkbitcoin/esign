// The workspaces a release stamp must touch. Publishing stamps VERSION into
// the published packages; every workspace that depends on one of them by
// version must be stamped to the same VERSION, or `npm ci` (in the service
// image, for instance) no longer matches the workspace link and asks the
// registry for a version that does not exist. Guarded by workspaces.test.mjs,
// which compares this table with the manifests.

/** The packages that get a version stamp. */
export const PUBLISHED_PACKAGES = [
  'packages/esign-core',
  'packages/esign-node',
  'packages/esign-react-native',
  'packages/esign-react',
  'packages/esign-service',
];

/**
 * Workspace directory → the published packages it depends on by version.
 * Devtools-only workspaces (scripts) and workspaces without an internal
 * dependency are absent.
 */
export const INTERNAL_DEPENDENCIES = {
  'packages/esign-react-native': ['@blinkbitcoin/esign-core'],
  'packages/esign-react': ['@blinkbitcoin/esign-core'],
  'packages/esign-service': ['@blinkbitcoin/esign-node'],
  'examples/mint-only-demo': ['@blinkbitcoin/esign-node'],
  'examples/serverless-handler-demo': ['@blinkbitcoin/esign-node'],
  'examples/react-demo': ['@blinkbitcoin/esign-react'],
  'examples/react-native-demo': ['@blinkbitcoin/esign-react-native'],
};

/** The `npm pkg set` arguments that stamp `version` into every dependent. */
export const dependencyStamps = (version, edges = INTERNAL_DEPENDENCIES) =>
  Object.entries(edges).flatMap(([dir, deps]) =>
    deps.map(name => ({
      dir,
      args: ['pkg', 'set', `dependencies.${name}=${version}`],
    })),
  );
