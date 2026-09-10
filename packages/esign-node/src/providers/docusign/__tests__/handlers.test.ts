// The handlers' DocuSign mint target: createWebFormInstance bound to a
// config or a client.

import { fakeFetch, ok, testConfig, token } from '../../../__tests__/support';
import { createDocuSignClient } from '../client';
import { mintFromDocuSign } from '../handlers';

describe('mintFromDocuSign', () => {
  it('mints through a client, with the target return url over the config one', async () => {
    const { fetchImpl, body } = fakeFetch([
      token(),
      ok({ formUrl: 'https://f', instanceToken: 'T', id: 'i-9' }),
    ]);
    const client = createDocuSignClient(testConfig(), { fetch: fetchImpl });
    const mint = mintFromDocuSign({
      client,
      returnUrl: 'https://host.example/return',
      expirationOffsetHours: 2,
    });
    await expect(mint('user-2', { reference: 'E2E-1' })).resolves.toEqual({
      url: 'https://f#instanceToken=T',
      instanceId: 'i-9',
    });
    expect(body(1)).toEqual({
      clientUserId: 'user-2',
      formValues: { reference: 'E2E-1' },
      returnUrl: 'https://host.example/return',
      expirationOffset: 2,
    });
  });

  it('mints from a config, one client per config object', async () => {
    const config = testConfig({ webFormId: undefined });
    const mint = mintFromDocuSign({ config });
    // The config is checked before any network call
    await expect(mint('u', {})).rejects.toMatchObject({
      name: 'DocuSignConfigError',
      missing: ['DOCUSIGN_WEBFORM_ID'],
    });
  });
});
