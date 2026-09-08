import { type ESignProvider, supportsWebForms } from '../provider';

const base: ESignProvider = {
  createEnvelope: jest.fn(),
  getEnvelopeStatus: jest.fn(),
  getSigningUrl: jest.fn(),
  verifyWebhook: jest.fn(),
  parseWebhookEvent: jest.fn(),
};

describe('supportsWebForms', () => {
  it('is true when the provider implements createWebFormInstance', () => {
    const provider: ESignProvider = {
      ...base,
      createWebFormInstance: async () => ({ url: 'https://f' }),
    };
    expect(supportsWebForms(provider)).toBe(true);
    if (supportsWebForms(provider)) {
      // The type guard narrows the optional method to required
      expect(typeof provider.createWebFormInstance).toBe('function');
    }
  });

  it('is false when the method is absent or not a function', () => {
    expect(supportsWebForms(base)).toBe(false);
    expect(
      supportsWebForms({
        ...base,
        createWebFormInstance: undefined,
      }),
    ).toBe(false);
    expect(
      supportsWebForms({
        ...base,
        createWebFormInstance: 'nope' as unknown as undefined,
      }),
    ).toBe(false);
  });
});
