import { createHostedFormMinter } from '../mint';

const reply = (status: number, json: unknown) =>
  ({ ok: status < 300, status, json: async () => json }) as Response;

describe('createHostedFormMinter', () => {
  it('POSTs an empty prefill when none is given', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValue(reply(200, { url: 'https://f#instanceToken=T' }));
    await expect(
      createHostedFormMinter({
        url: 'https://api/form/instance',
        getAuthToken: () => 't',
        fetch: fetchImpl,
      })(),
    ).resolves.toEqual({
      url: 'https://f#instanceToken=T',
      envelopeId: undefined,
    });
    expect(fetchImpl.mock.calls[0][1].body).toBe(
      JSON.stringify({ prefill: {} }),
    );
  });

  it('sends the provider-shaped prefill as given', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValue(reply(200, { url: 'u', instanceId: 'i' }));
    const mint = createHostedFormMinter<{ nested: { deep: boolean } }>(
      { url: 'x', getAuthToken: () => undefined, fetch: fetchImpl },
      { nested: { deep: true } },
    );
    await expect(mint()).resolves.toEqual({ url: 'u', envelopeId: 'i' });
    expect(fetchImpl.mock.calls[0][1].body).toBe(
      JSON.stringify({ prefill: { nested: { deep: true } } }),
    );
  });
});
