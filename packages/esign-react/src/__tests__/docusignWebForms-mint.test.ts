// The DocuSign.js source with the `mint` option: same endpoint contract as
// createWebFormsSource, then the SDK mounts the minted URL.

import { createDocuSignWebFormsSource } from '../docusignWebForms';

import type { DocuSignSdk } from '../docusignWebForms';

const reply = (status: number, json: unknown) =>
  ({ ok: status < 300, status, json: async () => json }) as Response;

describe('createDocuSignWebFormsSource with mint', () => {
  it('mints through the endpoint, then mounts the minted URL', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValue(
        reply(200, { url: 'https://f#instanceToken=T', instanceId: 'i-1' }),
      );
    const signing = { on: jest.fn(), mount: jest.fn(), close: jest.fn() };
    const sdk: DocuSignSdk = { signing: jest.fn().mockReturnValue(signing) };
    const source = createDocuSignWebFormsSource({
      mint: {
        url: 'https://api/webform/instance',
        getAuthToken: () => 'jwt',
        fetch: fetchImpl,
      },
      prefill: { units: 10 },
      integrationKey: 'ik',
      loadDocuSign: async () => sdk,
    });

    await expect(source.start()).resolves.toEqual({
      url: 'https://f#instanceToken=T',
      envelopeId: 'i-1',
    });
    expect(fetchImpl.mock.calls[0][1].body).toBe(
      JSON.stringify({ prefill: { units: 10 } }),
    );

    const cleanup = await source.mount(
      document.createElement('div'),
      jest.fn(),
    );
    expect(sdk.signing).toHaveBeenCalledWith({
      url: 'https://f#instanceToken=T',
      displayFormat: 'focused',
    });
    cleanup();
    expect(signing.close).toHaveBeenCalled();
  });

  it('maps a failed mint to ENVELOPE_CREATION_FAILED', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(reply(502, {}));
    const source = createDocuSignWebFormsSource({
      mint: { url: 'x', getAuthToken: () => 't', fetch: fetchImpl },
      integrationKey: 'ik',
      loadDocuSign: async () => ({ signing: jest.fn() }),
    });
    await expect(source.start()).rejects.toEqual({
      code: 'ENVELOPE_CREATION_FAILED',
      message: 'Could not mint the signing instance (HTTP 502)',
    });
  });
});
