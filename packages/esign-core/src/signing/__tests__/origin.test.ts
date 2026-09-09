import { isAllowedOrigin } from '../origin';

import type { SigningSession } from '../types';

describe('isAllowedOrigin', () => {
  it.each<[string, SigningSession | null | undefined, string, boolean]>([
    [
      'the pinned origin',
      { url: 'https://sign/1', allowedOrigin: 'https://sign.test' },
      'https://sign.test',
      true,
    ],
    [
      'another origin',
      { url: 'https://sign/1', allowedOrigin: 'https://sign.test' },
      'https://evil.test',
      false,
    ],
    [
      'a subdomain of the pinned origin',
      { url: 'https://sign/1', allowedOrigin: 'https://sign.test' },
      'https://app.sign.test',
      false,
    ],
    [
      'the pinned origin in another scheme',
      { url: 'https://sign/1', allowedOrigin: 'https://sign.test' },
      'http://sign.test',
      false,
    ],
    [
      'any origin when none is pinned',
      { url: 'https://sign/1' },
      'https://anywhere.test',
      true,
    ],
    [
      'any origin when the pin is empty',
      { url: 'https://sign/1', allowedOrigin: '' },
      'https://anywhere.test',
      true,
    ],
    ['any origin without a session', null, 'https://anywhere.test', true],
    [
      'any origin with an undefined session',
      undefined,
      'https://anywhere.test',
      true,
    ],
  ])('accepts/rejects %s', (_label, session, origin, expected) => {
    expect(isAllowedOrigin(session, origin)).toBe(expected);
  });
});
