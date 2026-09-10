// Who may be believed about the client's address.

import { forwardedClientIp, trustsProxy } from '../src/proxy';

const request = (forwardedFor?: string) =>
  new Request('https://api.example.com/webhook/esign', {
    method: 'POST',
    ...(forwardedFor ? { headers: { 'x-forwarded-for': forwardedFor } } : {}),
  });

describe('trustsProxy', () => {
  it('is true only for the exact string "true"', () => {
    expect(trustsProxy({ TRUST_PROXY: 'true' })).toBe(true);
    expect(trustsProxy({ TRUST_PROXY: 'yes' })).toBe(false);
    expect(trustsProxy({})).toBe(false);
  });
});

describe('forwardedClientIp', () => {
  it('takes the first entry of the chain when the proxy is trusted', () => {
    expect(forwardedClientIp(request('203.0.113.7, 10.0.0.1'), true)).toBe('203.0.113.7');
    expect(forwardedClientIp(request('  203.0.113.7  '), true)).toBe('203.0.113.7');
  });

  it('ignores the header when no proxy is trusted (any caller can set it)', () => {
    expect(forwardedClientIp(request('203.0.113.7'), false)).toBeUndefined();
  });

  it('is undefined when the header is absent or empty', () => {
    expect(forwardedClientIp(request(), true)).toBeUndefined();
    expect(forwardedClientIp(request('   '), true)).toBeUndefined();
  });
});
