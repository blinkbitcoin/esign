// The capability set is decided by the environment alone: the mint is
// always on (a Web Form, or an envelope under ESIGN_MINT_MODE=envelope),
// envelope orchestration follows DATABASE_URL.

import {
  capabilitiesFromEnv,
  describeCapabilities,
  hasEnvelopes,
  isEnvelopeMint,
  isMintMode,
  mockPagesEnabled,
  requestedMintMode,
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

describe('the mint mode', () => {
  it('is the Web Form unless the environment asks for envelopes', () => {
    expect(requestedMintMode({})).toBe('webform');
    expect(isEnvelopeMint({})).toBe(false);
    expect(isEnvelopeMint({ ESIGN_MINT_MODE: 'webform' })).toBe(false);
  });

  it('answers with envelopes under ESIGN_MINT_MODE=envelope', () => {
    expect(requestedMintMode({ ESIGN_MINT_MODE: 'envelope' })).toBe('envelope');
    expect(isEnvelopeMint({ ESIGN_MINT_MODE: 'envelope' })).toBe(true);
  });

  it('reports a mode it does not know as written, for the boot guard to refuse', () => {
    expect(requestedMintMode({ ESIGN_MINT_MODE: 'pdf' })).toBe('pdf');
    expect(isMintMode('pdf')).toBe(false);
    expect(isMintMode('webform')).toBe(true);
    expect(isMintMode('envelope')).toBe(true);
  });

  // An env file with `ESIGN_MINT_MODE=` must not stop a deployment from booting
  it('reads a blank ESIGN_MINT_MODE as unset, as a blank DATABASE_URL is', () => {
    expect(requestedMintMode({ ESIGN_MINT_MODE: '' })).toBe('webform');
    expect(requestedMintMode({ ESIGN_MINT_MODE: '   ' })).toBe('webform');
    expect(requestedMintMode({ ESIGN_MINT_MODE: ' envelope ' })).toBe('envelope');
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
