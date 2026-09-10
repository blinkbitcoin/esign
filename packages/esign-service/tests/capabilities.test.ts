// The capability set is decided by the environment alone: the mint is
// always on, envelope orchestration follows DATABASE_URL.

import {
  capabilitiesFromEnv,
  describeCapabilities,
  hasEnvelopes,
  mockPagesEnabled,
} from '../src/capabilities';

describe('hasEnvelopes', () => {
  it('is off without DATABASE_URL', () => {
    expect(hasEnvelopes({})).toBe(false);
  });

  it('is on with a DATABASE_URL', () => {
    expect(hasEnvelopes({ DATABASE_URL: 'postgres://u@h/db' })).toBe(true);
  });

  it('treats a blank DATABASE_URL as unset', () => {
    expect(hasEnvelopes({ DATABASE_URL: '   ' })).toBe(false);
    expect(hasEnvelopes({ DATABASE_URL: '' })).toBe(false);
  });
});

describe('capabilitiesFromEnv', () => {
  it('is mint-only without DATABASE_URL', () => {
    expect(capabilitiesFromEnv({})).toEqual(['mint']);
  });

  it('adds envelopes with DATABASE_URL', () => {
    expect(capabilitiesFromEnv({ DATABASE_URL: 'postgres://u@h/db' })).toEqual([
      'mint',
      'envelopes',
    ]);
  });

  it('ignores every other variable', () => {
    expect(capabilitiesFromEnv({ ESIGN_PROVIDER: 'docusign', PORT: '4000' })).toEqual(['mint']);
  });
});

describe('describeCapabilities', () => {
  it('lists the capabilities that are on', () => {
    expect(describeCapabilities(['mint'])).toBe('mint');
    expect(describeCapabilities(['mint', 'envelopes'])).toBe('mint, envelopes');
  });
});

describe('mockPagesEnabled', () => {
  it('is on for the mock provider (the default)', () => {
    expect(mockPagesEnabled({})).toBe(true);
    expect(mockPagesEnabled({ ESIGN_PROVIDER: 'mock' })).toBe(true);
  });

  it('is off for a real provider, which hosts its own pages', () => {
    expect(mockPagesEnabled({ ESIGN_PROVIDER: 'docusign' })).toBe(false);
  });

  it('can be turned off explicitly', () => {
    expect(mockPagesEnabled({ ESIGN_PROVIDER: 'mock', MOCK_PAGES: 'false' })).toBe(false);
  });
});
