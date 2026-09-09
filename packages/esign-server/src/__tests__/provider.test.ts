import {
  type ESignProvider,
  hostedFormMint,
  supportsHostedForms,
  supportsWebForms,
} from '../provider';

const base: ESignProvider = {
  createEnvelope: jest.fn(),
  getEnvelopeStatus: jest.fn(),
  getSigningUrl: jest.fn(),
  verifyWebhook: jest.fn(),
  parseWebhookEvent: jest.fn(),
};

describe('supportsHostedForms', () => {
  it('is true when the provider implements createHostedFormInstance', () => {
    const provider: ESignProvider = {
      ...base,
      createHostedFormInstance: async () => ({ url: 'https://f' }),
    };
    expect(supportsHostedForms(provider)).toBe(true);
  });

  it('is true for an adapter written against the deprecated name', () => {
    const provider: ESignProvider = {
      ...base,
      createWebFormInstance: async () => ({ url: 'https://f' }),
    };
    expect(supportsHostedForms(provider)).toBe(true);
  });

  it('is false when neither method is present or a function', () => {
    expect(supportsHostedForms(base)).toBe(false);
    expect(
      supportsHostedForms({
        ...base,
        createHostedFormInstance: undefined,
        createWebFormInstance: 'nope' as unknown as undefined,
      }),
    ).toBe(false);
  });
});

describe('supportsWebForms (deprecated alias)', () => {
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

describe('hostedFormMint', () => {
  it('binds createHostedFormInstance to the provider', async () => {
    const provider: ESignProvider = {
      ...base,
      async createHostedFormInstance(userId, prefill) {
        expect(this).toBe(provider);
        return { url: `https://f/${userId}`, instanceId: String(prefill.n) };
      },
    };
    const mint = hostedFormMint(provider);
    expect(mint).toBeDefined();
    await expect(mint!('u', { n: 1 })).resolves.toEqual({
      url: 'https://f/u',
      instanceId: '1',
    });
  });

  it('prefers the neutral name, then falls back to createWebFormInstance', async () => {
    const hosted = jest.fn().mockResolvedValue({ url: 'hosted' });
    const legacy = jest.fn().mockResolvedValue({ url: 'legacy' });
    const both = hostedFormMint({
      ...base,
      createHostedFormInstance: hosted,
      createWebFormInstance: legacy,
    });
    await expect(both!('u', {})).resolves.toEqual({ url: 'hosted' });
    expect(legacy).not.toHaveBeenCalled();

    const old = hostedFormMint({ ...base, createWebFormInstance: legacy });
    await expect(old!('u', { a: 'b' })).resolves.toEqual({ url: 'legacy' });
    expect(legacy).toHaveBeenCalledWith('u', { a: 'b' });
  });

  it('is undefined for a provider without the capability', () => {
    expect(hostedFormMint(base)).toBeUndefined();
  });
});
