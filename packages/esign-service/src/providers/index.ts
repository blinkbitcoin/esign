// Provider selection + composition root. `ESIGN_PROVIDER` names an entry of
// this service's registry: the package adapters wired to the service's
// config and policy, each wrapped in tracing.
//
// Selection is a function of the environment it is handed, and it builds
// fresh adapters every time. Nothing is constructed at module load, so a
// Worker's bindings - never `process.env` - decide what a Worker mints with,
// and an app built with an injected provider has no singleton to disagree
// with.

import { type ProviderRegistry, providerFromEnv } from '@blinkbitcoin/esign-node';
import type { Env } from '../env';
import { instrumentProvider } from '../tracing';
import type { WebFormPrefill } from '../types';
import {
  createProvider as createDocuSignProvider,
  validateConfig as validateDocuSignConfig,
} from './docusign';
import { createMock } from './mock';

import type { ESignProvider } from './port';

// What a minted hosted-form instance locked, by instance id. Only the mock
// has one: a real provider hosts its own pages.
export type MockPrefillLookup = (instanceId: string) => WebFormPrefill | undefined;

export interface ProviderSelection {
  // The adapter to mint and verify webhooks with, wrapped in tracing spans
  provider: ESignProvider;
  // Present when the mock was selected: the very handle's prefill lookup, so
  // the mock pages render what this app's mint stored
  mockPrefill?: MockPrefillLookup;
}

// The adapter `ESIGN_PROVIDER` names in `env`, plus whatever else that
// choice makes available. Every adapter is wrapped in tracing here, so new
// providers are instrumented by construction (see instrumentProvider in
// tracing.ts). The entries are lazy: DocuSign's configuration is validated
// only when selected (fail-fast at startup, never per request); an unknown
// name warns and falls back to the mock.
export const selectProvider = (env: Env = process.env): ProviderSelection => {
  let mockPrefill: MockPrefillLookup | undefined;
  const registry: ProviderRegistry = {
    mock: () => {
      const handle = createMock(env);
      mockPrefill = (instanceId) => handle.getWebFormPrefill(instanceId);
      return instrumentProvider(handle, 'mock');
    },
    docusign: () => {
      validateDocuSignConfig(env);
      return instrumentProvider(createDocuSignProvider(env), 'docusign');
    },
  };

  const provider = providerFromEnv(env, registry);
  return mockPrefill ? { provider, mockPrefill } : { provider };
};

// The adapter alone, for callers that do not serve pages
export const getProvider = (env: Env = process.env): ESignProvider => selectProvider(env).provider;

// Re-export the port for convenience (consumers can import both from here)
export type { ESignProvider } from './port';
export { supportsHostedForms, supportsWebForms } from './port';
