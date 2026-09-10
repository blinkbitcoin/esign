// Provider selection from the environment: ESIGN_PROVIDER names an entry of
// a registry of adapter factories. The factories are lazy, so selecting one
// provider never configures another (the mock needs no DOCUSIGN_* values).
// Every host in this repo selects its provider this way; a host with its own
// adapter adds an entry.

import { assertProductionConfig } from './production';
import {
  type ESignProvider,
  type HostedFormProvider,
  supportsHostedForms,
} from './provider';
import {
  assertDocuSignConfig,
  type DocuSignConfigKey,
  docuSignConfigFromEnv,
  docuSignDemoHostsInUse,
  type Env,
  HOSTED_FORM_SETTINGS,
} from './providers/docusign/config';
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
  docusign?: {
    // The settings that must be present when the DocuSign entry is selected
    // (default: none - the adapter validates per operation). A host that
    // mints hosted forms passes HOSTED_FORM_SETTINGS to fail at boot
    // instead of on the first mutation.
    required?: readonly DocuSignConfigKey[];
  };
}

// The two adapters this package ships, configured from `env`:
//   docusign - the real adapter over DOCUSIGN_* (read when selected)
//   mock     - in-memory, pages under mockBaseUrl, DocuSign's webhook format
export const defaultRegistry = (
  env: Env,
  options: DefaultRegistryOptions = {},
): ProviderRegistry => {
  // The adapter itself, with no boot checks: what the mock mirrors webhook
  // verification with (it needs no DOCUSIGN_* values, and must never be
  // refused because the DocuSign settings are absent or demo)
  const docusignAdapter = () =>
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
    // Selecting DocuSign is a boot check: the settings the host declared
    // required must be present, and production must not be on demo hosts
    docusign: () => {
      const config = docuSignConfigFromEnv(env);
      assertDocuSignConfig(config, options.docusign?.required ?? []);
      assertProductionConfig(env, {
        provider: 'docusign',
        demoHosts: docuSignDemoHostsInUse(config),
      });
      return docusignAdapter();
    },
    mock: () => {
      assertProductionConfig(env, { provider: 'mock', demo: true });
      return createMockProvider({
        baseUrl:
          options.mockBaseUrl ??
          (() => env.MOCK_PAGES_ORIGIN || 'http://localhost:4100'),
        webhook: docusignAdapter(),
      });
    },
  };
};

export interface HostedFormProviderOptions
  extends DefaultRegistryOptions,
    ProviderFromEnvOptions {
  // The registry to select from (default: defaultRegistry(env, options))
  registry?: ProviderRegistry;
}

// The provider a hosted-form host mints with: ESIGN_PROVIDER over the
// default registry, DocuSign unless set, with everything a mint needs
// required at selection time. Throws when the settings are missing
// (DocuSignConfigError), when production is on demo settings
// (ProductionConfigError), or when the selected provider has no hosted-form
// capability at all - all three at boot, never on the first request.
export const hostedFormProviderFromEnv = (
  env: Env,
  options: HostedFormProviderOptions = {},
): HostedFormProvider => {
  const {
    registry,
    default: fallback,
    onUnknown,
    ...registryOptions
  } = options;
  const provider = providerFromEnv(
    env,
    registry ??
      defaultRegistry(env, {
        ...registryOptions,
        docusign: {
          required: HOSTED_FORM_SETTINGS,
          ...registryOptions.docusign,
        },
      }),
    { default: fallback ?? 'docusign', onUnknown },
  );
  if (!supportsHostedForms(provider)) {
    throw new Error('The selected provider cannot mint hosted forms');
  }
  return provider;
};
