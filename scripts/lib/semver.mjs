// Shared parsing for release tags of the form vX.Y.Z or vX.Y.Z-<prerelease>.
// Single source of truth for the release-tag shape; scripts/lib/resolve-version.mjs
// is the only caller today.
const VERSION_TAG_RE = /^v[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$/;

/**
 * @param {string | undefined} tag
 * @returns {{ version: string, prerelease: boolean } | null}
 */
export function parseVersionTag(tag) {
  if (typeof tag !== 'string' || !VERSION_TAG_RE.test(tag)) return null;
  const version = tag.slice(1);
  return { version, prerelease: version.includes('-') };
}
