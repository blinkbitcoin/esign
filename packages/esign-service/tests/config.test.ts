// The boot guard: what refuses to start, and what it says when it does.
//
// The list is deliberately short. It refuses what is broken - credentials a
// mint cannot do without, a provider name nothing answers to, a runtime
// asked for something it cannot do - and nothing else. What a deployment
// does not verify is reported by the banner (posture.test.ts), and becomes
// a refusal only under ESIGN_STRICT.

import { configErrors, getAllowedOrigins, isStrict, validateConfig } from '../src/config';
import { silentLogger } from './support/app';

// The smallest environment that boots: the mock provider, nothing else.
// Tests add what they are about.
const devEnv = (extra: Record<string, string | undefined> = {}) => ({
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

describe('isStrict', () => {
  // A typo must neither arm the gate nor silently disarm it
  it('is true only for the exact string "true"', () => {
    expect(isStrict({ ESIGN_STRICT: 'true' })).toBe(true);
    expect(isStrict({ ESIGN_STRICT: 'TRUE' })).toBe(false);
    expect(isStrict({ ESIGN_STRICT: '1' })).toBe(false);
    expect(isStrict({ ESIGN_STRICT: 'false' })).toBe(false);
    expect(isStrict({})).toBe(false);
  });
});

// The change this whole refactor is about: a deployment that verifies
// nothing is a deployment, not a misconfiguration. The banner says what it
// does not verify (posture.test.ts); the guard says nothing.
describe('configErrors - what is NOT a refusal', () => {
  it('accepts an environment with no session source at all', () => {
    expect(configErrors({ ESIGN_PROVIDER: 'mock' })).toEqual([]);
  });

  it('accepts a deployment with no prefill callback', () => {
    expect(configErrors(devEnv())).toEqual([]);
  });

  it('accepts a plaintext prefill callback on a public host', () => {
    expect(configErrors(devEnv({ ESIGN_PREFILL_URL: 'http://api.example.com/prefill' }))).toEqual(
      []
    );
  });

  it('accepts envelope orchestration with no webhook key', () => {
    expect(configErrors(devEnv({ DATABASE_URL: 'postgres://u@h/db' }))).toEqual([]);
  });

  it('accepts the mock provider and the DocuSign sandbox alike', () => {
    expect(configErrors(devEnv())).toEqual([]);
    expect(configErrors(docusignEnv())).toEqual([]);
  });
});

describe('configErrors - the prefill callback', () => {
  it('accepts an absolute http(s) ESIGN_PREFILL_URL', () => {
    expect(configErrors(devEnv({ ESIGN_PREFILL_URL: 'https://host.example.com/prefill' }))).toEqual(
      []
    );
    expect(configErrors(devEnv({ ESIGN_PREFILL_URL: 'http://localhost:4100/prefill' }))).toEqual(
      []
    );
  });

  // A URL the service cannot POST to is broken however the deployment is
  // labelled - the one prefill rule that survives
  it('refuses a relative or non-http ESIGN_PREFILL_URL', () => {
    expect(configErrors(devEnv({ ESIGN_PREFILL_URL: '/prefill' }))).toEqual([
      expect.stringMatching(/must be an absolute http\(s\) URL/),
    ]);
    expect(configErrors(devEnv({ ESIGN_PREFILL_URL: 'ftp://host/prefill' }))).toEqual([
      expect.stringMatching(/must be an absolute http\(s\) URL/),
    ]);
  });
});

describe('configErrors - the provider', () => {
  it('accepts the mock provider', () => {
    expect(configErrors(devEnv())).toEqual([]);
  });

  it('accepts DocuSign with every hosted-form setting present', () => {
    expect(configErrors(docusignEnv())).toEqual([]);
  });

  it('refuses DocuSign without the settings a mint needs', () => {
    const errors = configErrors({
      ESIGN_PROVIDER: 'docusign',
      DOCUSIGN_INTEGRATION_KEY: 'ik',
    });
    expect(errors).toEqual([expect.stringMatching(/DOCUSIGN_WEBFORM_ID/)]);
  });

  it('refuses an unknown ESIGN_PROVIDER instead of silently falling back', () => {
    expect(configErrors(devEnv({ ESIGN_PROVIDER: 'adobe' }))).toEqual([
      expect.stringMatching(/unknown ESIGN_PROVIDER: adobe/),
    ]);
  });
});

// The webhook key is no longer a refusal - an unverified webhook is a
// choice the banner reports. Under ESIGN_STRICT it becomes one again.
describe('configErrors - ESIGN_STRICT', () => {
  const verified = {
    ESIGN_SESSION_SECRET: 's',
    ESIGN_PREFILL_URL: 'https://api.example.com/prefill',
    DOCUSIGN_BASE_URL: 'https://na4.docusign.net/restapi',
    DOCUSIGN_OAUTH_URL: 'https://account.docusign.com',
    DOCUSIGN_WEBFORMS_BASE_URL: 'https://apps.docusign.com/api/webforms/v1.1',
  };

  it('refuses every unverified check, naming the variable that fixes it', () => {
    const errors = configErrors(devEnv({ ESIGN_STRICT: 'true' }));
    expect(errors).toEqual([
      expect.stringMatching(/provider is mock.*ESIGN_PROVIDER/),
      expect.stringMatching(/session is not verified.*ESIGN_SESSION_JWKS_URL/),
      expect.stringMatching(/prefill is client-supplied.*ESIGN_PREFILL_URL/),
    ]);
  });

  it('is satisfied when every check is verified', () => {
    expect(configErrors(docusignEnv({ ...verified, ESIGN_STRICT: 'true' }))).toEqual([]);
  });

  it('demands the webhook key once envelopes are on', () => {
    expect(
      configErrors(
        docusignEnv({ ...verified, ESIGN_STRICT: 'true', DATABASE_URL: 'postgres://u@h/db' })
      )
    ).toEqual([expect.stringMatching(/webhook is not verified.*DOCUSIGN_HMAC_KEY/)]);
  });

  it('is satisfied once the webhook key is set', () => {
    expect(
      configErrors(
        docusignEnv({
          ...verified,
          ESIGN_STRICT: 'true',
          DATABASE_URL: 'postgres://u@h/db',
          DOCUSIGN_HMAC_KEY: 'k',
        })
      )
    ).toEqual([]);
  });

  it('refuses a sandbox provider', () => {
    expect(
      configErrors(
        docusignEnv({
          ESIGN_SESSION_SECRET: 's',
          ESIGN_PREFILL_URL: 'https://api.example.com/prefill',
          ESIGN_STRICT: 'true',
        })
      )
    ).toEqual([expect.stringMatching(/provider is docusign.*demo host/)]);
  });

  it('demands nothing unless it is exactly "true"', () => {
    expect(configErrors(devEnv({ ESIGN_STRICT: '1' }))).toEqual([]);
    expect(configErrors(devEnv({ ESIGN_STRICT: 'TRUE' }))).toEqual([]);
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
        DOCUSIGN_PRIVATE_KEY: undefined,
        DOCUSIGN_PRIVATE_KEY_FILE: '/run/secrets/docusign.pem',
      }),
      { runtime: 'edge' }
    );
    expect(errors).toEqual([expect.stringMatching(/container-only/)]);
  });
});

describe('configErrors - the mint mode', () => {
  // The DocuSign settings an envelope mint needs: the templates instead of a
  // Web Form (dummy ids in the real shape - nothing here is a real template)
  const envelopeEnv = (extra: Record<string, string | undefined> = {}) =>
    docusignEnv({
      ESIGN_MINT_MODE: 'envelope',
      DOCUSIGN_WEBFORM_ID: undefined,
      DOCUSIGN_TEMPLATE_ID: 'membership,subscription,joinder',
      ...extra,
    });

  it('accepts the Web Form spelled out', () => {
    expect(configErrors(devEnv({ ESIGN_MINT_MODE: 'webform' }))).toEqual([]);
  });

  it('accepts DocuSign envelopes with no Web Form configured', () => {
    expect(configErrors(envelopeEnv())).toEqual([]);
  });

  it('refuses envelopes without the templates to send', () => {
    expect(configErrors(envelopeEnv({ DOCUSIGN_TEMPLATE_ID: undefined }))).toEqual([
      expect.stringMatching(/DOCUSIGN_TEMPLATE_ID/),
    ]);
  });

  it('refuses envelopes without the page DocuSign returns the signer to', () => {
    expect(configErrors(envelopeEnv({ DOCUSIGN_RETURN_URL: undefined }))).toEqual([
      expect.stringMatching(/DOCUSIGN_RETURN_URL/),
    ]);
  });

  // A production-shaped staging deployment on the DocuSign demo account: the
  // image's own posture, with the one bypass it documents
  it('accepts the demo account in production when demo settings are allowed', () => {
    expect(
      configErrors(
        envelopeEnv({
          ESIGN_SESSION_SECRET: 's',
          ESIGN_ENV: 'production',
        })
      )
    ).toEqual([]);
  });

  // The host decides the signer and the locked values from its own data, as
  // it decides a Web Form's
  it('accepts a terms callback for envelopes', () => {
    expect(
      configErrors(envelopeEnv({ ESIGN_PREFILL_URL: 'https://api.example.com/terms' }))
    ).toEqual([]);
  });

  // The envelope mint carries a signer as well as a prefill, so an envelope
  // deployment with no callback lets the caller name both. Reported, not
  // refused - and refused again under ESIGN_STRICT.
  it('accepts envelopes with no prefill callback, and refuses them under ESIGN_STRICT', () => {
    expect(configErrors(envelopeEnv({ ESIGN_SESSION_SECRET: 's' }))).toEqual([]);
    expect(configErrors(envelopeEnv({ ESIGN_SESSION_SECRET: 's', ESIGN_STRICT: 'true' }))).toEqual(
      expect.arrayContaining([expect.stringMatching(/prefill is client-supplied/)])
    );
  });

  it('refuses a mode it does not know', () => {
    expect(configErrors(devEnv({ ESIGN_MINT_MODE: 'pdf' }))).toEqual([
      "ESIGN_MINT_MODE must be 'webform' or 'envelope' (got pdf)",
    ]);
  });

  it('refuses an unknown ESIGN_PROVIDER for envelopes too', () => {
    expect(configErrors(devEnv({ ESIGN_MINT_MODE: 'envelope', ESIGN_PROVIDER: 'adobe' }))).toEqual([
      expect.stringMatching(/unknown ESIGN_PROVIDER: adobe/),
    ]);
  });

  it('refuses a PEM file path on the edge runtime for envelopes too', () => {
    const errors = configErrors(
      envelopeEnv({
        DOCUSIGN_PRIVATE_KEY: undefined,
        DOCUSIGN_PRIVATE_KEY_FILE: '/run/secrets/docusign.pem',
      }),
      { runtime: 'edge' }
    );
    expect(errors).toEqual([expect.stringMatching(/container-only/)]);
  });
});

describe('validateConfig', () => {
  it('returns the capabilities that are on', () => {
    expect(validateConfig(devEnv(), { logger: silentLogger() })).toEqual(['mint']);
    expect(
      validateConfig(devEnv({ DATABASE_URL: 'postgres://u@h/db' }), { logger: silentLogger() })
    ).toEqual(['mint', 'envelopes']);
  });

  // The whole point: an environment the old guard refused now starts, and
  // says what it does not verify instead of dying
  it('starts with nothing configured and prints what it does not verify', () => {
    const logger = silentLogger();
    expect(() => validateConfig({ ESIGN_PROVIDER: 'mock' }, { logger })).not.toThrow();
    const banner = logger.log.mock.calls[0]?.[0] as string;
    expect(banner).toContain('session       not verified');
    expect(banner).toContain('prefill       client-supplied');
  });

  it('prints the banner on every successful construction', () => {
    const logger = silentLogger();
    validateConfig(docusignEnv({ ESIGN_SESSION_SECRET: 's' }), { logger });
    expect(logger.log).toHaveBeenCalledTimes(1);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('still refuses what is actually broken, listing every problem at once', () => {
    const logger = silentLogger();
    expect(() =>
      validateConfig({ ESIGN_PROVIDER: 'docusign', DATABASE_URL: 'postgres://u@h/db' }, { logger })
    ).toThrow(/capabilities: mint, envelopes/);
    expect(() =>
      validateConfig({ ESIGN_PROVIDER: 'docusign', DATABASE_URL: 'postgres://u@h/db' }, { logger })
    ).toThrow(/DOCUSIGN_WEBFORM_ID/);
    // Nothing is printed by a deployment that does not start
    expect(logger.log).not.toHaveBeenCalled();
  });

  it('reads process.env by default', () => {
    expect(validateConfig(undefined, { logger: silentLogger() })).toEqual(['mint']);
  });
});

describe('getAllowedOrigins', () => {
  it('is empty by default', () => {
    expect(getAllowedOrigins({})).toEqual([]);
  });

  it('splits, trims, and drops blanks', () => {
    expect(
      getAllowedOrigins({ ESIGN_CORS_ALLOWED_ORIGINS: 'https://a.com, https://b.com ,, ' })
    ).toEqual(['https://a.com', 'https://b.com']);
  });
});
