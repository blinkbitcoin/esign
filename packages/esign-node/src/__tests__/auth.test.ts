import { bearerToken } from '../auth';

describe('bearerToken', () => {
  it.each([
    ['Bearer x', 'x'],
    ['Bearer  x  ', 'x'],
    ['Bearer eyJ.abc.def', 'eyJ.abc.def'],
  ])('reads the token out of %j', (header, token) => {
    expect(bearerToken(header)).toBe(token);
  });

  it.each<[string | null | undefined, string]>([
    ['Bearer ', 'an empty token'],
    ['Bearer    ', 'a whitespace-only token'],
    ['Bearer', 'the scheme alone'],
    ['bearer x', 'a lower-case scheme'],
    ['Basic dXNlcjpwYXNz', 'another scheme'],
    ['', 'an empty header'],
    [undefined, 'a missing header'],
    [null, 'a null header (Fetch Headers.get)'],
  ])('is null for %j (%s)', header => {
    expect(bearerToken(header)).toBeNull();
  });
});
