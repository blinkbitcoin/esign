// Provider registry + composition root. The package's providerFromEnv
// selects an adapter from ESIGN_PROVIDER out of this service's registry: the
// package adapters wired to the service's config and policy, each wrapped in
// tracing. Consumers import the `provider` singleton (or `getProvider` for
// tests); nothing else imports the adapters.

import { type ProviderRegistry, providerFromEnv } from '@blinkbitcoin/esign-server';
import { instrumentProvider } from '../tracing';
import { DocuSignProvider, validateConfig as validateDocuSignConfig } from './docusign';
import { MockProvider } from './mock';

import type { ESignProvider } from './port';

// Every adapter is wrapped in tracing spans here, so new providers are
// instrumented by construction (see instrumentProvider in tracing.ts). The
// entries are lazy: DocuSign's configuration is validated only when selected
// (fail-fast at startup, never per request).
export const registry: ProviderRegistry = {
  mock: () => instrumentProvider(MockProvider, 'mock'),
  docusign: () => {
    validateDocuSignConfig();
    return instrumentProvider(DocuSignProvider, 'docusign');
  },
};

// Provider factory function - exported for testing. An unknown name warns
// and falls back to the mock (the package's providerFromEnv default).
export const getProvider = (providerName?: string): ESignProvider =>
  providerFromEnv(
    providerName === undefined ? process.env : { ESIGN_PROVIDER: providerName },
    registry
  );

// Provider instance for use in resolvers/routes
export const provider = getProvider();

// Re-export the port for convenience (consumers can import both from here)
export type { ESignProvider } from './port';
export { supportsHostedForms, supportsWebForms } from './port';
