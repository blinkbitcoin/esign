// The one call to @blinkbitcoin/esign-server this host makes: the hosted-form
// mint of the provider ESIGN_PROVIDER selects. With real credentials that is
// the DocuSign adapter (createWebFormInstance underneath); with
// ESIGN_PROVIDER=mock the mock provider mints a URL onto the full-service
// demo's mock Web Forms page, so the mutation can be exercised with no
// DocuSign account.

import {
  assertDocuSignConfig,
  createDocuSignProvider,
  type DefaultRegistryOptions,
  defaultRegistry,
  docuSignConfigFromEnv,
  hostedFormMint,
  type ProviderRegistry,
  providerFromEnv,
  type WebFormPrefill,
} from '@blinkbitcoin/esign-server';

export type Mint = (
  userId: string,
  prefill: WebFormPrefill,
) => Promise<{ url: string; instanceId?: string }>;

// The mock provider: mints onto the full-service demo's mock Web Forms page.
// This host never receives webhooks; the mock mirrors DocuSign's anyway.
export const mockProvider = (
  env: NodeJS.ProcessEnv,
  options: DefaultRegistryOptions = {},
) => defaultRegistry(env, options).mock();

// The package's registry, with this host's DocuSign entry: the credentials
// are checked when the provider is selected (fail at startup, not on the
// first mutation), and one config object → one cached token.
export const registry = (
  env: NodeJS.ProcessEnv,
  options: DefaultRegistryOptions = {},
): ProviderRegistry => ({
  ...defaultRegistry(env, options),
  docusign: () => {
    const config = docuSignConfigFromEnv(env);
    assertDocuSignConfig(config);
    return createDocuSignProvider({
      config,
      webhook: { hmacKey: () => env.DOCUSIGN_HMAC_KEY, ...options.webhook },
    });
  },
});

// The mint for the selected provider (ESIGN_PROVIDER, DocuSign unless set)
export const createMint = (
  env: NodeJS.ProcessEnv = process.env,
  providers: ProviderRegistry = registry(env),
): Mint => {
  const mint = hostedFormMint(
    providerFromEnv(env, providers, { default: 'docusign' }),
  );
  if (!mint) {
    throw new Error('The selected provider cannot mint hosted forms');
  }
  return mint;
};
