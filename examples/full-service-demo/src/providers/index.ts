// Provider factory + composition root. Selects an ESignProvider adapter from
// ESIGN_PROVIDER and wraps it in tracing. Consumers import the `provider`
// singleton (or `getProvider` for tests); nothing else imports the adapters.

import { instrumentProvider } from '../tracing';
import { DocuSignProvider, validateConfig as validateDocuSignConfig } from './docusign';
import { MockProvider } from './mock';

import type { ESignProvider } from './port';

// Provider factory function - exported for testing
export const getProvider = (providerName?: string): ESignProvider => {
  const name = providerName ?? process.env.ESIGN_PROVIDER ?? 'mock';

  // Every adapter is wrapped in tracing spans here, so new providers are
  // instrumented by construction (see instrumentProvider in tracing.ts)
  switch (name) {
    case 'mock':
      return instrumentProvider(MockProvider, 'mock');
    case 'docusign':
      validateDocuSignConfig();
      return instrumentProvider(DocuSignProvider, 'docusign');
    default:
      console.warn(`Unknown ESIGN_PROVIDER: ${name}, falling back to mock`);
      return instrumentProvider(MockProvider, 'mock');
  }
};

// Provider instance for use in resolvers/routes
export const provider = getProvider();

// Re-export the port for convenience (consumers can import both from here)
export type { ESignProvider } from './port';
export { supportsWebForms } from './port';
