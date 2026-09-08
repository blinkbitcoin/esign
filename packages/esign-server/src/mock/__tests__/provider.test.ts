import { type ESignProvider, supportsWebForms } from '../../provider';
import { createMockProvider } from '../provider';

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const recipient = { name: 'Jane Signer', email: 'jane@example.com' };

// Narrow the optional Web Forms capability (fails loudly if it disappears)
const webForms = (provider: ESignProvider) => {
  if (!supportsWebForms(provider)) {
    throw new Error('provider has no Web Forms support');
  }
  return provider;
};

const setup = () => {
  let baseUrl = 'http://localhost:4000';
  const webhook = {
    verifyWebhook: jest.fn<boolean, Parameters<ESignProvider['verifyWebhook']>>(
      () => true,
    ),
    parseWebhookEvent: jest.fn<
      ReturnType<ESignProvider['parseWebhookEvent']>,
      Parameters<ESignProvider['parseWebhookEvent']>
    >(() => ({
      providerEnvelopeId: 'p',
      rawStatus: 'completed',
      status: 'completed',
    })),
  };
  const provider = createMockProvider({ baseUrl: () => baseUrl, webhook });
  return { provider, webhook, setBaseUrl: (url: string) => (baseUrl = url) };
};

describe('createMockProvider', () => {
  describe('createEnvelope', () => {
    it('returns a fresh uuid and a signing page under the base url', async () => {
      const { provider } = setup();
      const result = await provider.createEnvelope('user-1', 'nda', recipient);
      expect(result.envelopeId).toMatch(UUID);
      expect(result.signingUrl).toBe(
        `http://localhost:4000/signing/mock/${result.envelopeId}`,
      );
      expect(await provider.getEnvelopeStatus(result.envelopeId)).toBe('sent');
    });

    it('creates unique ids per call', async () => {
      const { provider } = setup();
      const a = await provider.createEnvelope('user-1', 'nda', recipient);
      const b = await provider.createEnvelope('user-1', 'nda', recipient);
      expect(a.envelopeId).not.toBe(b.envelopeId);
    });

    it('reads the base url per call (the port may change at runtime)', async () => {
      const { provider, setBaseUrl } = setup();
      const first = await provider.createEnvelope('user-1', 'nda', recipient);
      setBaseUrl('https://esign.example.com');
      const second = await provider.createEnvelope('user-1', 'nda', recipient);
      expect(first.signingUrl).toMatch(/^http:\/\/localhost:4000\//);
      expect(second.signingUrl).toMatch(/^https:\/\/esign\.example\.com\//);
      const restart = await provider.getSigningUrl(first.envelopeId, recipient);
      expect(restart.signingUrl).toBe(
        `https://esign.example.com/signing/mock/${first.envelopeId}?restart=true`,
      );
    });
  });

  describe('getEnvelopeStatus', () => {
    it('throws ENVELOPE_NOT_FOUND for an unknown envelope', async () => {
      const { provider } = setup();
      await expect(provider.getEnvelopeStatus('nope')).rejects.toMatchObject({
        code: 'ENVELOPE_NOT_FOUND',
      });
    });
  });

  describe('getSigningUrl', () => {
    it('returns a restart url for a known envelope', async () => {
      const { provider } = setup();
      const { envelopeId } = await provider.createEnvelope(
        'user-1',
        'nda',
        recipient,
      );
      expect(await provider.getSigningUrl(envelopeId, recipient)).toEqual({
        signingUrl: `http://localhost:4000/signing/mock/${envelopeId}?restart=true`,
      });
    });

    it('throws ENVELOPE_NOT_FOUND for an unknown envelope', async () => {
      const { provider } = setup();
      await expect(
        provider.getSigningUrl('nope', recipient),
      ).rejects.toMatchObject({ code: 'ENVELOPE_NOT_FOUND' });
    });
  });

  describe('webhooks', () => {
    it('delegates verification and parsing to the injected webhook implementation', () => {
      const { provider, webhook } = setup();
      const headers = { 'x-docusign-signature-1': 'sig' };
      expect(provider.verifyWebhook(headers, '{}', '10.0.0.1')).toBe(true);
      expect(webhook.verifyWebhook).toHaveBeenCalledWith(
        headers,
        '{}',
        '10.0.0.1',
      );
      expect(provider.parseWebhookEvent('{"x":1}')).toEqual({
        providerEnvelopeId: 'p',
        rawStatus: 'completed',
        status: 'completed',
      });
      expect(webhook.parseWebhookEvent).toHaveBeenCalledWith('{"x":1}');
    });
  });

  describe('createWebFormInstance', () => {
    it('mints an instance url under the base url and remembers the prefill', async () => {
      const { provider } = setup();
      const prefill = { number_of_units: 1000, reference: 'E2E-0001' };
      const result = await webForms(provider).createWebFormInstance(
        'user-1',
        prefill,
      );
      expect(result.instanceId).toMatch(UUID);
      expect(result.url).toBe(
        `http://localhost:4000/signing/mock-webform/${result.instanceId}`,
      );
      expect(provider.getWebFormPrefill(result.instanceId as string)).toBe(
        prefill,
      );
      expect(
        await provider.getEnvelopeStatus(result.instanceId as string),
      ).toBe('sent');
    });

    it('has no prefill for an unknown instance', () => {
      const { provider } = setup();
      expect(provider.getWebFormPrefill('nope')).toBeUndefined();
    });
  });

  describe('test helpers', () => {
    it('setEnvelopeStatus updates a known envelope and ignores unknown ones', async () => {
      const { provider } = setup();
      const { envelopeId } = await provider.createEnvelope(
        'user-1',
        'nda',
        recipient,
      );
      for (const status of [
        'completed',
        'voided',
        'declined',
        'sent',
      ] as const) {
        provider.setEnvelopeStatus(envelopeId, status);
        expect(await provider.getEnvelopeStatus(envelopeId)).toBe(status);
      }
      expect(() =>
        provider.setEnvelopeStatus('nope', 'completed'),
      ).not.toThrow();
      await expect(provider.getEnvelopeStatus('nope')).rejects.toMatchObject({
        code: 'ENVELOPE_NOT_FOUND',
      });
    });

    it('addEnvelope applies defaults and overrides', async () => {
      const { provider } = setup();
      provider.addEnvelope('env-default');
      expect(await provider.getEnvelopeStatus('env-default')).toBe('sent');
      provider.addEnvelope('env-custom', {
        status: 'completed',
        userId: 'user-9',
        contractType: 'custom',
      });
      expect(await provider.getEnvelopeStatus('env-custom')).toBe('completed');
      expect(await provider.getSigningUrl('env-custom', recipient)).toEqual({
        signingUrl:
          'http://localhost:4000/signing/mock/env-custom?restart=true',
      });
    });

    it('clearEnvelopes drops envelopes and web form instances', async () => {
      const { provider } = setup();
      const { envelopeId } = await provider.createEnvelope(
        'user-1',
        'nda',
        recipient,
      );
      const { instanceId } = await webForms(provider).createWebFormInstance(
        'user-1',
        {
          a: 'b',
        },
      );
      provider.clearEnvelopes();
      await expect(
        provider.getEnvelopeStatus(envelopeId),
      ).rejects.toMatchObject({ code: 'ENVELOPE_NOT_FOUND' });
      expect(provider.getWebFormPrefill(instanceId as string)).toBeUndefined();
      // Still usable afterwards
      const fresh = await provider.createEnvelope('user-1', 'nda', recipient);
      expect(await provider.getEnvelopeStatus(fresh.envelopeId)).toBe('sent');
    });
  });
});
