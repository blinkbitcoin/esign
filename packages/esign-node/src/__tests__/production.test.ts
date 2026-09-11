// The production boot guard: what ESIGN_ENV=production refuses, and the one
// explicit override. Provider-agnostic - the caller says which provider it
// selected and which demo settings that provider still uses.

import {
  assertProductionConfig,
  ESIGN_ALLOW_DEMO,
  ESIGN_ENV,
  ProductionConfigError,
  productionErrors,
} from '../production';

const production = { [ESIGN_ENV]: 'production' };

describe('productionErrors', () => {
  it.each([
    ['unset ESIGN_ENV', {}, { provider: 'mock', demo: true }, []],
    [
      'ESIGN_ENV=development',
      { [ESIGN_ENV]: 'development' },
      { provider: 'mock', demo: true },
      [],
    ],
    [
      'NODE_ENV=production alone (never the gate)',
      { NODE_ENV: 'production' },
      { provider: 'mock', demo: true },
      [],
    ],
    [
      'production with a real provider on real hosts',
      production,
      { provider: 'docusign', demoHosts: [] },
      [],
    ],
    [
      'production with a demo provider',
      production,
      { provider: 'mock', demo: true },
      ['ESIGN_ENV=production: the mock provider is a demo provider'],
    ],
    [
      'production with demo hosts',
      production,
      {
        provider: 'docusign',
        demoHosts: [
          'DOCUSIGN_BASE_URL=https://demo.docusign.net/restapi',
          'DOCUSIGN_OAUTH_URL=https://account-d.docusign.com',
        ],
      },
      [
        'ESIGN_ENV=production: DOCUSIGN_BASE_URL=https://demo.docusign.net/restapi is a demo host',
        'ESIGN_ENV=production: DOCUSIGN_OAUTH_URL=https://account-d.docusign.com is a demo host',
      ],
    ],
    [
      'ESIGN_ALLOW_DEMO=true bypasses everything',
      { ...production, [ESIGN_ALLOW_DEMO]: 'true' },
      { provider: 'mock', demo: true, demoHosts: ['DOCUSIGN_BASE_URL=x'] },
      [],
    ],
    [
      'ESIGN_ALLOW_DEMO=false is not a bypass',
      { ...production, [ESIGN_ALLOW_DEMO]: 'false' },
      { provider: 'mock', demo: true },
      ['ESIGN_ENV=production: the mock provider is a demo provider'],
    ],
  ])('%s', (_case, env, config, expected) => {
    expect(productionErrors(env, config)).toEqual(expected);
  });

  it('names both the variable it gates on and the override', () => {
    expect(ESIGN_ENV).toBe('ESIGN_ENV');
    expect(ESIGN_ALLOW_DEMO).toBe('ESIGN_ALLOW_DEMO');
  });
});

describe('assertProductionConfig', () => {
  it('passes silently when there is nothing to report', () => {
    expect(() =>
      assertProductionConfig(production, { provider: 'docusign' }),
    ).not.toThrow();
  });

  it('throws a ProductionConfigError listing every problem and the override', () => {
    try {
      assertProductionConfig(production, {
        provider: 'mock',
        demo: true,
        demoHosts: ['DOCUSIGN_BASE_URL=https://demo.docusign.net/restapi'],
      });
      throw new Error('did not throw');
    } catch (error) {
      expect(error).toBeInstanceOf(ProductionConfigError);
      expect((error as ProductionConfigError).errors).toEqual([
        'ESIGN_ENV=production: the mock provider is a demo provider',
        'ESIGN_ENV=production: DOCUSIGN_BASE_URL=https://demo.docusign.net/restapi is a demo host',
      ]);
      expect((error as Error).name).toBe('ProductionConfigError');
      expect((error as Error).message).toBe(
        'ESIGN_ENV=production: the mock provider is a demo provider; ' +
          'ESIGN_ENV=production: DOCUSIGN_BASE_URL=https://demo.docusign.net/restapi is a demo host. ' +
          'Set ESIGN_ALLOW_DEMO=true to allow demo settings in production.',
      );
    }
  });
});
