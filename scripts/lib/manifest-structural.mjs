// Which package.json changes are architecture-relevant. A dependency bump
// (Dependabot or by hand) only moves version ranges; a change to the
// workspace list, the exports map, the entry points, the scripts or the
// package identity is what docs may need to follow. docs-freshness uses
// this to decide whether a manifest change deserves the "docs not updated"
// warning.

/** Keys whose changes are dependency bookkeeping, never structure. */
export const DEPENDENCY_KEYS = [
  'dependencies',
  'devDependencies',
  'peerDependencies',
  'optionalDependencies',
  'overrides',
  'version',
];

const withoutDependencyKeys = manifest => {
  const copy = { ...manifest };
  for (const key of DEPENDENCY_KEYS) {
    delete copy[key];
  }
  return copy;
};

const stableJson = value =>
  JSON.stringify(value, (_key, v) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(
          Object.keys(v)
            .sort()
            .map(k => [k, v[k]]),
        )
      : v,
  );

/**
 * True when the two manifests differ in anything other than dependency
 * ranges and the version. Either side may be missing (added or deleted
 * manifest), which is always structural.
 */
export const isStructuralManifestChange = (before, after) => {
  if (!before || !after) {
    return true;
  }
  return (
    stableJson(withoutDependencyKeys(before)) !==
    stableJson(withoutDependencyKeys(after))
  );
};
