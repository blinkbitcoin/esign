// Which mint a deployment serves is one decision, made from ESIGN_MINT_MODE
// alone. What each mode then does (its endpoint, its provider checks, its
// terms) is covered through the app and the boot guard (app.test.ts,
// config.test.ts); this is the resolution itself.

import { envelopeProviderFromEnv, hostedFormProviderFromEnv } from '@blinkbitcoin/esign-node';

import { isMintModeName, mintModeFromEnv, requestedMintMode } from '../src/mint';

describe('requestedMintMode', () => {
  it('is the Web Form unless the environment asks otherwise', () => {
    expect(requestedMintMode({})).toBe('webform');
    expect(requestedMintMode({ ESIGN_MINT_MODE: 'envelope' })).toBe('envelope');
  });

  it('reports a name it does not know as written, for the boot guard to refuse', () => {
    expect(requestedMintMode({ ESIGN_MINT_MODE: 'pdf' })).toBe('pdf');
    expect(isMintModeName('pdf')).toBe(false);
    expect(isMintModeName('webform')).toBe(true);
    expect(isMintModeName('envelope')).toBe(true);
  });

  // An env file with `ESIGN_MINT_MODE=` must not stop a deployment from booting
  it('reads a blank ESIGN_MINT_MODE as unset, as a blank DATABASE_URL is', () => {
    expect(requestedMintMode({ ESIGN_MINT_MODE: '' })).toBe('webform');
    expect(requestedMintMode({ ESIGN_MINT_MODE: '   ' })).toBe('webform');
    expect(requestedMintMode({ ESIGN_MINT_MODE: ' envelope ' })).toBe('envelope');
  });
});

describe('mintModeFromEnv', () => {
  it('resolves each name to the mode that mints it', () => {
    expect(mintModeFromEnv({})).toMatchObject({
      name: 'webform',
      selectProvider: hostedFormProviderFromEnv,
    });
    expect(mintModeFromEnv({ ESIGN_MINT_MODE: 'envelope' })).toMatchObject({
      name: 'envelope',
      selectProvider: envelopeProviderFromEnv,
    });
  });

  // The boot guard refuses the name; every other check still runs as the
  // Web Form, so the guard lists them all at once
  it('runs an unknown name as the Web Form', () => {
    expect(mintModeFromEnv({ ESIGN_MINT_MODE: 'pdf' }).name).toBe('webform');
  });
});
