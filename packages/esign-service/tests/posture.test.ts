// The posture: what a deployment verifies, said out loud at boot instead of
// decided for the operator by a refusal.

import { formatBanner, type Line, postureLines } from '../src/posture';

// A deployment with nothing configured beyond the provider: the shape a
// first `docker run` has, and the one the old guard refused outright
const bare = { ESIGN_PROVIDER: 'mock' };

const lineFor = (env: Record<string, string | undefined>, check: Line['check']): Line => {
  const line = postureLines(env).find((candidate) => candidate.check === check);
  if (!line) {
    throw new Error(`no ${check} line`);
  }
  return line;
};

// Real DocuSign hosts, so the provider line is not about the sandbox
const productionDocuSign = {
  ESIGN_PROVIDER: 'docusign',
  DOCUSIGN_BASE_URL: 'https://na4.docusign.net/restapi',
  DOCUSIGN_OAUTH_URL: 'https://account.docusign.com',
  DOCUSIGN_WEBFORMS_BASE_URL: 'https://apps.docusign.com/api/webforms/v1.1',
};

describe('postureLines', () => {
  it('reports every check, in banner order', () => {
    expect(postureLines(bare).map((line) => line.check)).toEqual([
      'provider',
      'session',
      'prefill',
      'webhook',
    ]);
  });

  describe('session', () => {
    it('is unverified when no source is configured', () => {
      expect(lineFor(bare, 'session')).toEqual({
        check: 'session',
        verified: false,
        detail: 'not verified - the bearer token is the user id',
      });
    });

    it('names the key set when ESIGN_SESSION_JWKS_URL is set', () => {
      expect(
        lineFor({ ...bare, ESIGN_SESSION_JWKS_URL: 'https://id.example.com/jwks' }, 'session')
      ).toEqual({ check: 'session', verified: true, detail: 'verified (ESIGN_SESSION_JWKS_URL)' });
    });

    it('names the shared secret when ESIGN_SESSION_SECRET is set', () => {
      expect(lineFor({ ...bare, ESIGN_SESSION_SECRET: 's' }, 'session')).toEqual({
        check: 'session',
        verified: true,
        detail: 'verified (ESIGN_SESSION_SECRET)',
      });
    });
  });

  describe('prefill', () => {
    it('is client-supplied when no callback is configured', () => {
      expect(lineFor(bare, 'prefill')).toEqual({
        check: 'prefill',
        verified: false,
        detail: 'client-supplied (ESIGN_PREFILL_URL unset)',
      });
    });

    it('is the host when ESIGN_PREFILL_URL is set', () => {
      expect(
        lineFor({ ...bare, ESIGN_PREFILL_URL: 'https://api.example.com/prefill' }, 'prefill')
      ).toEqual({ check: 'prefill', verified: true, detail: 'from ESIGN_PREFILL_URL' });
    });
  });

  describe('webhook', () => {
    // A route that does not exist has nothing unverified about it, so this
    // reads as verified rather than as a warning a mint-only deployment can
    // never act on
    it('does not apply without envelope orchestration', () => {
      expect(lineFor(bare, 'webhook')).toEqual({
        check: 'webhook',
        verified: true,
        detail: 'n/a (mint only)',
      });
    });

    it('is unverified once envelopes are on and no key is set', () => {
      expect(lineFor({ ...bare, DATABASE_URL: 'postgres://u@h/db' }, 'webhook')).toEqual({
        check: 'webhook',
        verified: false,
        detail: 'not verified (DOCUSIGN_HMAC_KEY unset)',
      });
    });

    it('is verified once the key is set', () => {
      expect(
        lineFor({ ...bare, DATABASE_URL: 'postgres://u@h/db', DOCUSIGN_HMAC_KEY: 'k' }, 'webhook')
      ).toEqual({ check: 'webhook', verified: true, detail: 'verified (DOCUSIGN_HMAC_KEY)' });
    });
  });

  describe('provider', () => {
    it('calls the mock a demo provider', () => {
      expect(lineFor(bare, 'provider')).toEqual({
        check: 'provider',
        verified: false,
        detail: 'mock - the mock provider is a demo provider',
      });
    });

    it('names the demo hosts DocuSign still points at', () => {
      const line = lineFor({ ESIGN_PROVIDER: 'docusign' }, 'provider');
      expect(line.verified).toBe(false);
      expect(line.detail).toContain('is a demo host');
    });

    it('is verified for DocuSign on production hosts', () => {
      expect(lineFor(productionDocuSign, 'provider')).toEqual({
        check: 'provider',
        verified: true,
        detail: 'docusign',
      });
    });

    // An unknown name is a boot error, so by banner time it is the mock
    it('treats an unknown provider name as the mock', () => {
      expect(lineFor({ ESIGN_PROVIDER: 'adobe' }, 'provider').detail).toContain('mock');
    });

    // The shape of a first `docker run` with nothing but a port
    it('reports the mock when ESIGN_PROVIDER is unset', () => {
      expect(lineFor({}, 'provider')).toEqual({
        check: 'provider',
        verified: false,
        detail: 'mock - the mock provider is a demo provider',
      });
    });
  });
});

describe('formatBanner', () => {
  it('reports the capabilities, the mint mode and every check', () => {
    const banner = formatBanner(bare, ['mint']);
    expect(banner).toContain('capabilities  mint');
    expect(banner).toContain('mint mode     webform');
    expect(banner).toContain('session       not verified');
    expect(banner).toContain('prefill       client-supplied');
    expect(banner).toContain('webhook       n/a (mint only)');
    expect(banner).toContain('provider      mock');
  });

  it('reports the envelope mint mode and the envelope capability', () => {
    const banner = formatBanner(
      { ...bare, ESIGN_MINT_MODE: 'envelope', DATABASE_URL: 'postgres://u@h/db' },
      ['mint', 'envelopes']
    );
    expect(banner).toContain('capabilities  mint, envelopes');
    expect(banner).toContain('mint mode     envelope');
  });

  // Six lines, one per row, every time: an operator finds "session" in the
  // same place whether or not it is verified
  it('is one line per row whatever the environment', () => {
    expect(formatBanner(bare, ['mint']).split('\n')).toHaveLength(6);
    expect(formatBanner(productionDocuSign, ['mint']).split('\n')).toHaveLength(6);
  });
});
