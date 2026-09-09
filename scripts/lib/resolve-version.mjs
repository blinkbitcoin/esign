// Pure decision logic for scripts/release/resolve-version.mjs (the CLI wraps
// this with env parsing, git calls and the npm pkg set side effects). Kept
// here so the rules - and the exact ::error:: messages the CLI prints - are
// unit tested without touching git or the filesystem.
//   release event : the tag IS the version (vX.Y.Z -> X.Y.Z, dist-tag latest;
//                   vX.Y.Z-<pre> -> dist-tag next). The commit must be on main.
//   anything else : prerelease <next-patch-after-latest-v*-tag>-pre.<run>.<sha>
//                   under dist-tag next.
import { parseVersionTag } from './semver.mjs';

export class ResolveVersionError extends Error {}

/**
 * @param {object} params
 * @param {string} params.event - github.event_name ('release' or anything else)
 * @param {string} params.tag - release tag (release event only); the caller
 *   defaults a missing env var to '' the way the shell's `${TAG:-}` did
 * @param {string | number} params.run - CI run number (push event only)
 * @param {string} params.sha - commit SHA (full or short)
 * @param {string} [params.shortSha] - abbreviated SHA for the prerelease
 *   suffix (the CLI passes `git rev-parse --short`); defaults to the first 7
 *   characters of `sha`
 * @param {string | null | undefined} params.latestTag - latest `v*` tag, or
 *   null/undefined when there is none yet (defaults to 'v0.0.0')
 * @param {boolean} params.onMain - whether `sha` is an ancestor of
 *   origin/main (release event only)
 * @returns {{ version: string, disttag: 'latest' | 'next' }}
 */
export function resolveVersion({
  event,
  tag,
  run,
  sha,
  shortSha,
  latestTag,
  onMain,
}) {
  if (event === 'release') {
    const parsed = parseVersionTag(tag);
    if (!parsed) {
      throw new ResolveVersionError(
        `::error::release tag '${tag}' is not vX.Y.Z or vX.Y.Z-<prerelease>`,
      );
    }
    if (!onMain) {
      throw new ResolveVersionError(
        `::error::release commit ${sha.slice(0, 7)} is not on main - use \`gh release create --target main\``,
      );
    }
    return {
      version: parsed.version,
      disttag: parsed.prerelease ? 'next' : 'latest',
    };
  }

  const latest = (latestTag ?? 'v0.0.0').replace(/^v/, '').replace(/-.*$/, '');
  const [major, minor, patch] = latest.split('.');
  const version = `${major}.${minor}.${Number(patch) + 1}-pre.${run}.${shortSha ?? sha.slice(0, 7)}`;
  return { version, disttag: 'next' };
}
