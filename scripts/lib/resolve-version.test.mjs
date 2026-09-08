import { describe, expect, it } from 'vitest';
import { ResolveVersionError, resolveVersion } from './resolve-version.mjs';

describe('resolveVersion', () => {
  describe('release event', () => {
    it('publishes a stable tag under latest', () => {
      expect(
        resolveVersion({
          event: 'release',
          tag: 'v0.1.0',
          onMain: true,
        }),
      ).toEqual({ version: '0.1.0', disttag: 'latest' });
    });

    it('publishes a prerelease-suffixed tag under next', () => {
      expect(
        resolveVersion({
          event: 'release',
          tag: 'v1.2.3-rc.1',
          onMain: true,
        }),
      ).toEqual({ version: '1.2.3-rc.1', disttag: 'next' });
    });

    it.each([
      ['missing the leading v', '1.0.0'],
      ['missing the patch component', 'v1.0'],
      ['an extra version component', 'v1.0.0.0'],
      ['an empty string', ''],
    ])('rejects %s (%j) with the tag error', (_label, tag) => {
      expect(() =>
        resolveVersion({ event: 'release', tag, onMain: true }),
      ).toThrowError(
        new ResolveVersionError(
          `::error::release tag '${tag}' is not vX.Y.Z or vX.Y.Z-<prerelease>`,
        ),
      );
    });

    it('rejects a commit that is not on main', () => {
      expect(() =>
        resolveVersion({
          event: 'release',
          tag: 'v0.1.0',
          sha: 'abcdef1234567890',
          onMain: false,
        }),
      ).toThrowError(
        new ResolveVersionError(
          '::error::release commit abcdef1 is not on main - use `gh release create --target main`',
        ),
      );
    });
  });

  describe('push event', () => {
    it('bumps the patch after v0.0.0 when there is no latest tag', () => {
      expect(
        resolveVersion({
          event: 'push',
          run: 5,
          sha: '1234567890abcdef',
          latestTag: null,
        }),
      ).toEqual({ version: '0.0.1-pre.5.1234567', disttag: 'next' });
    });

    it('bumps the patch after a stable latest tag', () => {
      expect(
        resolveVersion({
          event: 'push',
          run: 42,
          sha: 'fedcba9876543210',
          latestTag: 'v1.2.3',
        }),
      ).toEqual({ version: '1.2.4-pre.42.fedcba9', disttag: 'next' });
    });

    it('strips a prerelease suffix off the latest tag before bumping', () => {
      expect(
        resolveVersion({
          event: 'push',
          run: 7,
          sha: '0011223344556677',
          latestTag: 'v1.2.3-rc.1',
        }),
      ).toEqual({ version: '1.2.4-pre.7.0011223', disttag: 'next' });
    });

    it('uses an explicit shortSha instead of slicing the sha', () => {
      expect(
        resolveVersion({
          event: 'push',
          run: '12',
          sha: '0123456789abcdef0123456789abcdef01234567',
          shortSha: '0123456789',
          latestTag: 'v1.2.3',
        }),
      ).toEqual({ version: '1.2.4-pre.12.0123456789', disttag: 'next' });
    });

    it('substitutes run and the first 7 sha characters', () => {
      expect(
        resolveVersion({
          event: 'push',
          run: 99,
          sha: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          latestTag: 'v0.0.0',
        }),
      ).toEqual({ version: '0.0.1-pre.99.aaaaaaa', disttag: 'next' });
    });
  });
});
