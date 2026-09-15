// Two registries decide which provider this service runs, and nothing has
// ever asserted they agree.
//
// The boot guard selects through the package's registry (config.ts, via the
// mint mode's selectProvider) to find out whether the settings a mint needs
// are present. Every request selects through the service's own registry
// (providers/index.ts), which wires the service's adapters and tracing.
//
// They were already divergent - only the first ran the production guard that
// this refactor removed - and a configuration the boot guard accepts while
// the running app builds something else would be invisible: the container
// starts clean and mints with a provider nobody checked.

import { mintModeFromEnv } from '../src/mint';
import { describeProvider, selectProvider } from '../src/providers';

// Real values in the real shape; nothing here is a credential.
const docusign = {
  ESIGN_PROVIDER: 'docusign',
  DOCUSIGN_INTEGRATION_KEY: 'ik',
  DOCUSIGN_ACCOUNT_ID: 'acct',
  DOCUSIGN_USER_ID: 'user',
  DOCUSIGN_PRIVATE_KEY: 'pem',
  DOCUSIGN_WEBFORM_ID: 'form',
  DOCUSIGN_RETURN_URL: 'https://api.example.com/signing/return',
};

const envelope = {
  ...docusign,
  ESIGN_MINT_MODE: 'envelope',
  DOCUSIGN_TEMPLATE_ID: 'tpl',
};

const CASES: Array<[string, Record<string, string | undefined>]> = [
  ['the mock, named', { ESIGN_PROVIDER: 'mock' }],
  ['the mock, by default', {}],
  ['the mock with its pages off', { ESIGN_PROVIDER: 'mock', ESIGN_MOCK_PAGES: 'false' }],
  ['DocuSign for a Web Form mint', docusign],
  ['DocuSign for an envelope mint', envelope],
];

describe.each(CASES)('provider selection for %s', (_name, env) => {
  // The boot guard accepting a configuration must mean the running app can
  // build it: if the package's selection succeeds, the service's must too.
  it('builds at request time whatever the boot guard accepted', () => {
    expect(() => mintModeFromEnv(env).selectProvider(env, { default: 'mock' })).not.toThrow();
    expect(() => selectProvider(env)).not.toThrow();
  });

  // The banner names a provider too, and an operator reading
  // "provider  docusign" must be reading about the adapter that mints
  it('is the provider the banner reports', () => {
    expect(selectProvider(env).name).toBe(describeProvider(env).name);
  });
});
