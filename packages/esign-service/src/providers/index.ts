// Provider registry + composition root. The package's providerFromEnv
// selects an adapter from ESIGN_PROVIDER out of this service's registry: the
// package adapters wired to the service's config and policy, each wrapped in
// tracing. Consumers import the `provider` singleton (or `getProvider` for
// tests); nothing else imports the adapters.

import { type ProviderRegistry, providerFromEnv } from '@blinkbitcoin/esign-node';
import type { Env } from '../env';
import { instrumentProvider } from '../tracing';
import {
  createProvider as createDocuSignProvider,
  validateConfig as validateDocuSignConfig,
} from './docusign';
import { MockProvider } from './mock';

import type { ESignProvider } from './port';

// Every adapter is wrapped in tracing spans here, so new providers are
// instrumented by construction (see instrumentProvider in tracing.ts). The
// entries are lazy: DocuSign's configuration is validated only when selected
// (fail-fast at startup, never per request).
export const createRegistry = (env: Env = process.env): ProviderRegistry => ({
  mock: () => instrumentProvider(MockProvider, 'mock'),
  docusign: () => {
    validateDocuSignConfig(env);
    return instrumentProvider(createDocuSignProvider(env), 'docusign');
  },
});

export const registry: ProviderRegistry = createRegistry();

// The adapter ESIGN_PROVIDER names in `env`. Taking the environment (rather
// than a name) is what lets a function target hand in its platform env
// instead of process.env. An unknown name warns and falls back to the mock
// (the package's providerFromEnv default).
export const getProvider = (env: Env = process.env): ESignProvider =>
  providerFromEnv(env, createRegistry(env));

// Provider instance for use in resolvers/routes
export const provider = getProvider();

// Re-export the port for convenience (consumers can import both from here)
export type { ESignProvider } from './port';
export { supportsHostedForms, supportsWebForms } from './port';
