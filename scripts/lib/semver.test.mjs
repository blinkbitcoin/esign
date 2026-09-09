import { describe, expect, it } from 'vitest';
import { parseVersionTag } from './semver.mjs';

describe('parseVersionTag', () => {
  it('parses a stable version tag', () => {
    expect(parseVersionTag('v1.2.3')).toEqual({
      version: '1.2.3',
      prerelease: false,
    });
  });

  it('parses a prerelease version tag', () => {
    expect(parseVersionTag('v1.2.3-rc.1')).toEqual({
      version: '1.2.3-rc.1',
      prerelease: true,
    });
  });

  it.each([
    ['missing the leading v', '1.0.0'],
    ['missing the patch component', 'v1.0'],
    ['an extra version component', 'v1.0.0.0'],
    ['an empty prerelease suffix', 'v1.0.0-'],
    ['an empty string', ''],
    ['undefined', undefined],
  ])('rejects %s (%j)', (_label, tag) => {
    expect(parseVersionTag(tag)).toBeNull();
  });
});
