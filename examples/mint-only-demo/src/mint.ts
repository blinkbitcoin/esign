// The one call to @blinkbitcoin/esign-server this host makes. With real
// credentials it is createWebFormInstance; with ESIGN_PROVIDER=mock the mock
// provider mints a URL onto the full-service demo's mock Web Forms page, so
// the mutation can be exercised with no DocuSign account.

import {
  assertDocuSignConfig,
  createDocuSignProvider,
  createMockProvider,
  createWebFormInstance,
  docuSignConfigFromEnv,
  type WebFormPrefill,
} from '@blinkbitcoin/esign-server';

export type Mint = (
  userId: string,
  prefill: WebFormPrefill,
) => Promise<{ url: string; instanceId?: string }>;

// The mock provider: mints onto the full-service demo's mock Web Forms page.
// This host never receives webhooks; the mock mirrors DocuSign's anyway.
export const mockProvider = (env: NodeJS.ProcessEnv) =>
  createMockProvider({
    baseUrl: () => env.MOCK_PAGES_ORIGIN || 'http://localhost:4000',
    webhook: createDocuSignProvider({
      config: docuSignConfigFromEnv(env),
      webhook: { hmacKey: () => env.DOCUSIGN_HMAC_KEY },
    }),
  });

export const createMint = (env: NodeJS.ProcessEnv = process.env): Mint => {
  if (env.ESIGN_PROVIDER === 'mock') {
    const mock = mockProvider(env);
    // The mock always supports Web Forms (optional on the port)
    return (userId, prefill) => mock.createWebFormInstance!(userId, prefill);
  }
  // One config object → one cached token
  const config = docuSignConfigFromEnv(env);
  assertDocuSignConfig(config);
  return (userId, prefill) =>
    createWebFormInstance({ config, userId, prefill });
};
