// Shared parsing for release tags of the form vX.Y.Z or vX.Y.Z-<prerelease>.
// Mirrors the regex `scripts/release/resolve-version.sh` checks the release
// tag against - kept here as the single source of truth once that script (and
// any other caller) is wired to it.
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
