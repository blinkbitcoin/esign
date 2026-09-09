// DocuSign configuration for the service: the package's DOCUSIGN_* env
// mapping, plus the service's own defaults and boot-time validation.

import {
  type DocuSignConfig,
  docuSignConfigFromEnv,
  JWT_CREDENTIALS,
  missingDocuSignConfig,
} from '@blinkbitcoin/esign-server';

// The service's return-URL bridge (app.ts serves /signing/return) unless
// DOCUSIGN_RETURN_URL points elsewhere
const DEFAULT_RETURN_URL = 'http://localhost:4000/signing/return';

// Configuration from environment variables (read on every call so tests and
// credential rotation see the current environment)
export const getConfig = (): DocuSignConfig => {
  const config = docuSignConfigFromEnv();
  return { ...config, returnUrl: config.returnUrl ?? DEFAULT_RETURN_URL };
};

// Validate required environment variables.
// Throws so a misconfigured server fails at startup with a clear message,
// instead of booting fine and crashing on the first request. The template is
// required because the service's envelope mode is always on; the Web Form id
// is checked lazily by the adapter (Web Forms mode is optional).
export const validateConfig = (): void => {
  const missing = missingDocuSignConfig(getConfig(), [...JWT_CREDENTIALS, 'templateId']);
  if (missing.length > 0) {
    throw new Error(
      `DocuSign provider: Missing required environment variables: ${missing.join(', ')}`
    );
  }
};
