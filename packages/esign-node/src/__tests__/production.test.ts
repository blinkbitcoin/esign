// Demo settings are described, never judged: the same configuration
// describes the same way whatever the deployment claims to be, because this
// library cannot tell a staging deployment on the sandbox (correct) from a
// production one (a mistake). The service decides what to do with the answer.

import { demoSettings } from '../production';

describe('demoSettings', () => {
  it('is empty for a real provider on real hosts', () => {
    expect(demoSettings({ provider: 'docusign', demoHosts: [] })).toEqual([]);
  });

  it('is empty when no demo settings are declared at all', () => {
    expect(demoSettings({ provider: 'docusign' })).toEqual([]);
  });

  it('names a demo provider', () => {
    expect(demoSettings({ provider: 'mock', demo: true })).toEqual([
      'the mock provider is a demo provider',
    ]);
  });

  it('names each demo host, in the order given', () => {
    expect(
      demoSettings({
        provider: 'docusign',
        demoHosts: [
          'DOCUSIGN_BASE_URL=https://demo.docusign.net/restapi',
          'DOCUSIGN_OAUTH_URL=https://account-d.docusign.com',
        ],
      }),
    ).toEqual([
      'DOCUSIGN_BASE_URL=https://demo.docusign.net/restapi is a demo host',
      'DOCUSIGN_OAUTH_URL=https://account-d.docusign.com is a demo host',
    ]);
  });

  it('names the provider and its hosts together', () => {
    expect(
      demoSettings({
        provider: 'mock',
        demo: true,
        demoHosts: ['DOCUSIGN_BASE_URL=https://demo.docusign.net/restapi'],
      }),
    ).toEqual([
      'the mock provider is a demo provider',
      'DOCUSIGN_BASE_URL=https://demo.docusign.net/restapi is a demo host',
    ]);
  });

  // The regression this file exists for: the old guard read ESIGN_ENV and
  // ESIGN_ALLOW_DEMO and threw. Nothing here reads an environment at all, so
  // no deployment can be refused by this package for how it is labelled.
  it('reads no environment', () => {
    const before = { ...process.env };
    process.env.ESIGN_ENV = 'production';
    process.env.ESIGN_ALLOW_DEMO = 'false';
    try {
      expect(demoSettings({ provider: 'mock', demo: true })).toEqual([
        'the mock provider is a demo provider',
      ]);
    } finally {
      process.env = before;
    }
  });
});
