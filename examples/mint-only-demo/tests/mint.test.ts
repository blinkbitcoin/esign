import { createMint } from '../src/mint';

describe('createMint', () => {
  it('mock provider: mints a URL onto the mock Web Forms page', async () => {
    const mint = createMint({
      ESIGN_PROVIDER: 'mock',
      MOCK_PAGES_ORIGIN: 'http://pages:4000',
    });
    const result = await mint('user-1', { number_of_units: 10 });
    expect(result.url).toMatch(/^http:\/\/pages:4000\/signing\/mock-webform\//);
    expect(result.instanceId).toBeDefined();
  });

  it('mock provider: defaults the pages origin to the full-service demo', async () => {
    const mint = createMint({ ESIGN_PROVIDER: 'mock' });
    expect((await mint('user-1', {})).url).toMatch(
      /^http:\/\/localhost:4100\//,
    );
  });

  it('docusign: is the default, refusing to start without the JWT-grant credentials', () => {
    expect(() => createMint({ ESIGN_PROVIDER: 'docusign' })).toThrow(
      /DOCUSIGN_/,
    );
    expect(() => createMint({})).toThrow(/DOCUSIGN_/);
  });

  it('docusign: boots (no network call yet) once every hosted-form setting is present', () => {
    const env = {
      DOCUSIGN_ACCOUNT_ID: 'acc',
      DOCUSIGN_INTEGRATION_KEY: 'key',
      DOCUSIGN_USER_ID: 'uid',
      DOCUSIGN_PRIVATE_KEY: 'pem',
      DOCUSIGN_WEBFORM_ID: 'form',
      DOCUSIGN_RETURN_URL: 'http://localhost:4100/signing/return',
    };
    expect(() => createMint(env)).not.toThrow();
  });
});
