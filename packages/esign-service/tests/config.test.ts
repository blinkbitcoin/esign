// The boot guard: what refuses to start, and what it says when it does.

import { vi } from 'vitest';

import {
  configErrors,
  getAllowedOrigins,
  isInsecureDevAllowed,
  isJwtRequired,
  isWebhookSignatureRequired,
  validateConfig,
} from '../src/config';

// The smallest environment that boots: the dev passthrough, the mock
// provider, no database (mint only). Tests add what they are about.
const devEnv = (extra: Record<string, string | undefined> = {}) => ({
  ALLOW_INSECURE_DEV: 'true',
  ESIGN_PROVIDER: 'mock',
  ...extra,
});

// The DocuSign settings a hosted-form mint needs (dummy values in the real
// shape - nothing here is a credential)
const docusignEnv = (extra: Record<string, string | undefined> = {}) => ({
  ESIGN_PROVIDER: 'docusign',
  DOCUSIGN_INTEGRATION_KEY: 'ik',
  DOCUSIGN_ACCOUNT_ID: 'acct',
  DOCUSIGN_USER_ID: 'user',
  DOCUSIGN_PRIVATE_KEY: 'pem',
  DOCUSIGN_WEBFORM_ID: 'form',
  DOCUSIGN_RETURN_URL: 'https://api.example.com/signing/return',
  ...extra,
});

describe('isInsecureDevAllowed', () => {
  it('is true only for the exact string "true"', () => {
    expect(isInsecureDevAllowed({ ALLOW_INSECURE_DEV: 'true' })).toBe(true);
    expect(isInsecureDevAllowed({ ALLOW_INSECURE_DEV: 'TRUE' })).toBe(false);
    expect(isInsecureDevAllowed({ ALLOW_INSECURE_DEV: '1' })).toBe(false);
    expect(isInsecureDevAllowed({})).toBe(false);
  });
});

describe('isJwtRequired / isWebhookSignatureRequired', () => {
  it('require secrets unless insecure-dev is allowed', () => {
    expect(isJwtRequired({})).toBe(true);
    expect(isWebhookSignatureRequired({})).toBe(true);
    expect(isJwtRequired({ ALLOW_INSECURE_DEV: 'true' })).toBe(false);
    expect(isWebhookSignatureRequired({ ALLOW_INSECURE_DEV: 'true' })).toBe(false);
  });
});

describe('configErrors - the session source', () => {
  it('refuses an environment that verifies nothing', () => {
    expect(configErrors({ ESIGN_PROVIDER: 'mock' })).toEqual([
      expect.stringMatching(/no session verification is configured/),
    ]);
  });

  it('accepts a JWKS url, a shared secret, the JWT_SECRET alias, or the dev switch', () => {
    expect(configErrors({ ESIGN_PROVIDER: 'mock', SESSION_JWKS_URL: 'https://id/jwks' })).toEqual(
      []
    );
    expect(configErrors({ ESIGN_PROVIDER: 'mock', SESSION_HS256_SECRET: 's' })).toEqual([]);
    expect(configErrors({ ESIGN_PROVIDER: 'mock', JWT_SECRET: 's' })).toEqual([]);
    expect(configErrors(devEnv())).toEqual([]);
  });
});

describe('configErrors - the terms callback', () => {
  it('accepts an absolute http(s) TERMS_URL', () => {
    expect(configErrors(devEnv({ TERMS_URL: 'https://host.example.com/terms' }))).toEqual([]);
    expect(configErrors(devEnv({ TERMS_URL: 'http://localhost:4100/terms' }))).toEqual([]);
  });

  it('refuses a relative or non-http TERMS_URL', () => {
    expect(configErrors(devEnv({ TERMS_URL: '/terms' }))).toEqual([
      expect.stringMatching(/absolute http\(s\) URL/),
    ]);
    expect(configErrors(devEnv({ TERMS_URL: 'ftp://host/terms' }))).toEqual([
      expect.stringMatching(/absolute http\(s\) URL/),
    ]);
  });

  it('refuses production without TERMS_URL: client values would be minted as sent', () => {
    const errors = configErrors(
      docusignEnv({ ESIGN_ENV: 'production', ESIGN_ALLOW_DEMO: 'true', JWT_SECRET: 's' })
    );
    expect(errors).toEqual([expect.stringMatching(/would be minted as sent/)]);
  });

  it('allows production without TERMS_URL when the operator says so explicitly', () => {
    expect(
      configErrors(
        docusignEnv({
          ESIGN_ENV: 'production',
          ESIGN_ALLOW_DEMO: 'true',
          JWT_SECRET: 's',
          ESIGN_ALLOW_CLIENT_PREFILL: 'true',
        })
      )
    ).toEqual([]);
  });

  it('does not ask for TERMS_URL outside production', () => {
    expect(configErrors(devEnv())).toEqual([]);
  });
});

describe('configErrors - the provider', () => {
  it('accepts the mock provider', () => {
    expect(configErrors(devEnv())).toEqual([]);
  });

  it('accepts DocuSign with every hosted-form setting present', () => {
    expect(configErrors(docusignEnv({ ALLOW_INSECURE_DEV: 'true' }))).toEqual([]);
  });

  it('refuses DocuSign without the settings a mint needs', () => {
    const errors = configErrors({
      ALLOW_INSECURE_DEV: 'true',
      ESIGN_PROVIDER: 'docusign',
      DOCUSIGN_INTEGRATION_KEY: 'ik',
    });
    expect(errors).toEqual([expect.stringMatching(/DOCUSIGN_WEBFORM_ID/)]);
  });

  it('refuses production on the mock provider', () => {
    const errors = configErrors(
      devEnv({ ESIGN_ENV: 'production', ESIGN_ALLOW_CLIENT_PREFILL: 'true' })
    );
    expect(errors).toEqual([expect.stringMatching(/mock provider is a demo provider/)]);
  });

  it('refuses production on DocuSign demo hosts', () => {
    const errors = configErrors(
      docusignEnv({
        ALLOW_INSECURE_DEV: 'true',
        ESIGN_ENV: 'production',
        ESIGN_ALLOW_CLIENT_PREFILL: 'true',
        DOCUSIGN_BASE_URL: 'https://demo.docusign.net/restapi',
      })
    );
    expect(errors).toEqual([expect.stringMatching(/demo host/)]);
  });

  it('refuses an unknown ESIGN_PROVIDER instead of silently falling back', () => {
    expect(configErrors(devEnv({ ESIGN_PROVIDER: 'adobe' }))).toEqual([
      expect.stringMatching(/unknown ESIGN_PROVIDER: adobe/),
    ]);
  });
});

describe('configErrors - the envelope webhook', () => {
  it('requires DOCUSIGN_HMAC_KEY once envelopes are on', () => {
    const errors = configErrors(
      docusignEnv({ JWT_SECRET: 's', DATABASE_URL: 'postgres://u@h/db' })
    );
    expect(errors).toEqual([expect.stringMatching(/DOCUSIGN_HMAC_KEY/)]);
  });

  it('does not require it without a database (mint only)', () => {
    expect(configErrors(docusignEnv({ JWT_SECRET: 's' }))).toEqual([]);
  });

  it('does not require it for the mock provider', () => {
    expect(configErrors(devEnv({ JWT_SECRET: 's', DATABASE_URL: 'postgres://u@h/db' }))).toEqual(
      []
    );
  });

  it('is satisfied by the key, or by the insecure-dev switch', () => {
    expect(
      configErrors(
        docusignEnv({ JWT_SECRET: 's', DATABASE_URL: 'postgres://u@h/db', DOCUSIGN_HMAC_KEY: 'k' })
      )
    ).toEqual([]);
    expect(
      configErrors(docusignEnv({ ALLOW_INSECURE_DEV: 'true', DATABASE_URL: 'postgres://u@h/db' }))
    ).toEqual([]);
  });
});

describe('configErrors - runtime vs capability', () => {
  it('refuses envelope orchestration on the edge runtime', () => {
    const errors = configErrors(devEnv({ DATABASE_URL: 'postgres://u@h/db' }), {
      runtime: 'edge',
    });
    expect(errors).toEqual([expect.stringMatching(/cannot open a Postgres connection/)]);
  });

  it('accepts the mint on the edge runtime', () => {
    expect(configErrors(devEnv(), { runtime: 'edge' })).toEqual([]);
  });

  it('refuses a PEM file path on the edge runtime (no filesystem)', () => {
    const errors = configErrors(
      docusignEnv({
        ALLOW_INSECURE_DEV: 'true',
        DOCUSIGN_PRIVATE_KEY: undefined,
        DOCUSIGN_PRIVATE_KEY_FILE: '/run/secrets/docusign.pem',
      }),
      { runtime: 'edge' }
    );
    expect(errors).toEqual([expect.stringMatching(/container-only/)]);
  });
});

describe('validateConfig', () => {
  afterEach(() => vi.restoreAllMocks());

  it('returns the capabilities that are on', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(validateConfig(devEnv())).toEqual(['mint']);
    expect(validateConfig(devEnv({ DATABASE_URL: 'postgres://u@h/db' }))).toEqual([
      'mint',
      'envelopes',
    ]);
  });

  it('warns when the insecure-dev switch is on', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    validateConfig(devEnv());
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('ALLOW_INSECURE_DEV=true'));
  });

  it('does not warn for a properly configured deployment', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    validateConfig(docusignEnv({ JWT_SECRET: 's' }));
    expect(warn).not.toHaveBeenCalled();
  });

  it('lists every problem at once, with the capabilities that are on', () => {
    expect(() =>
      validateConfig({ ESIGN_PROVIDER: 'docusign', DATABASE_URL: 'postgres://u@h/db' })
    ).toThrow(/capabilities: mint, envelopes/);
    expect(() =>
      validateConfig({ ESIGN_PROVIDER: 'docusign', DATABASE_URL: 'postgres://u@h/db' })
    ).toThrow(/no session verification.*DOCUSIGN_WEBFORM_ID.*DOCUSIGN_HMAC_KEY/s);
  });

  it('reads process.env by default', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    // tests/setup.ts sets ALLOW_INSECURE_DEV=true for the whole suite
    expect(validateConfig()).toEqual(['mint']);
  });
});

describe('getAllowedOrigins', () => {
  it('is empty by default', () => {
    expect(getAllowedOrigins({})).toEqual([]);
  });

  it('splits, trims, and drops blanks', () => {
    expect(getAllowedOrigins({ CORS_ALLOWED_ORIGINS: 'https://a.com, https://b.com ,, ' })).toEqual(
      ['https://a.com', 'https://b.com']
    );
  });
});
