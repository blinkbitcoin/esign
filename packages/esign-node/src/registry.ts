// Provider selection from the environment: ESIGN_PROVIDER names an entry of
// a registry of adapter factories. The factories are lazy, so selecting one
// provider never configures another (the mock needs no DOCUSIGN_* values).
// Every host in this repo selects its provider this way; a host with its own
// adapter adds an entry.

import type { ESignProvider } from './provider';
import { docuSignConfigFromEnv, type Env } from './providers/docusign/config';
import type { DocuSignWebhookOptions } from './providers/docusign/provider';
import { createDocuSignProvider } from './providers/docusign/provider';
import { createMockProvider } from './providers/mock/provider';

// Provider name → factory (called once, when that provider is selected)
export type ProviderRegistry = Record<string, () => ESignProvider>;

// The environment variable naming the provider
export const ESIGN_PROVIDER_ENV = 'ESIGN_PROVIDER';

export interface ProviderFromEnvOptions {
  // The registry entry used when ESIGN_PROVIDER is unset or unknown (default 'mock')
  default?: string;
  // Called once for an unknown name before the default is used (default: console.warn)
  onUnknown?: (name: string, fallback: string) => void;
}

const warnUnknown = (name: string, fallback: string): void => {
  console.warn(
    `Unknown ${ESIGN_PROVIDER_ENV}: ${name}, falling back to ${fallback}`,
  );
};

// The provider ESIGN_PROVIDER names in `registry`; the default entry when
// the variable is unset; the default entry plus one warning when it names
// nothing in the registry (a typo must not silently pick another provider,
// but must not take the service down either).
export const providerFromEnv = (
  env: Env,
  registry: ProviderRegistry,
  options: ProviderFromEnvOptions = {},
): ESignProvider => {
  const fallback = options.default ?? 'mock';
  const name = env[ESIGN_PROVIDER_ENV] ?? fallback;
  // Own entries only: 'constructor' and friends are not providers
  if (Object.hasOwn(registry, name)) {
    return registry[name]();
  }
  (options.onUnknown ?? warnUnknown)(name, fallback);
  return registry[fallback]();
};

export interface DefaultRegistryOptions {
  // The DocuSign adapter's webhook policy; the mock mirrors it. Default: the
  // Connect HMAC key from DOCUSIGN_HMAC_KEY, signatures required.
  webhook?: Partial<DocuSignWebhookOptions>;
  // Where the mock's signing pages are served (the esign service does).
  // Default: MOCK_PAGES_ORIGIN, else http://localhost:4100 (the
  // service's default port; a dev-only fallback).
  mockBaseUrl?: () => string;
}

// The two adapters this package ships, configured from `env`:
//   docusign - the real adapter over DOCUSIGN_* (read when selected)
//   mock     - in-memory, pages under mockBaseUrl, DocuSign's webhook format
export const defaultRegistry = (
  env: Env,
  options: DefaultRegistryOptions = {},
): ProviderRegistry => {
  const docusign = () =>
    createDocuSignProvider({
      // A getter: the client (and its token cache) is built on first use,
      // so a selected mock never reads the credentials
      config: () => docuSignConfigFromEnv(env),
      webhook: {
        hmacKey: () => env.DOCUSIGN_HMAC_KEY,
        ...options.webhook,
      },
    });
  return {
    docusign,
    mock: () =>
      createMockProvider({
        baseUrl:
          options.mockBaseUrl ??
          (() => env.MOCK_PAGES_ORIGIN || 'http://localhost:4100'),
        webhook: docusign(),
      }),
  };
};
