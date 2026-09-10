// DocuSign configuration for the service: the package's DOCUSIGN_* env
// mapping, plus the service's own defaults and boot-time validation.

import {
  type DocuSignConfig,
  type DocuSignConfigKey,
  docuSignConfigFromEnv,
  JWT_CREDENTIALS,
  missingDocuSignConfig,
} from '@blinkbitcoin/esign-node';
import { hasEnvelopes } from '../../capabilities';
import type { Env } from '../../env';
import { localOrigin } from '../../port';

// The service's return-URL bridge (app.ts serves /signing/return) on this
// service's own port unless DOCUSIGN_RETURN_URL points elsewhere
const defaultReturnUrl = (env: Env): string => `${localOrigin(env)}/signing/return`;

// Configuration from environment variables (read on every call so tests and
// credential rotation see the current environment)
export const getConfig = (env: Env = process.env): DocuSignConfig => {
  const config = docuSignConfigFromEnv(env);
  return { ...config, returnUrl: config.returnUrl ?? defaultReturnUrl(env) };
};

// The settings this deployment's capabilities need: the JWT credentials
// always, and the envelope template only when envelope orchestration is on
// (a mint-only deployment sends no template-based envelopes). The hosted-form
// settings are the boot guard's (config.ts, via hostedFormProviderFromEnv).
const requiredSettings = (env: Env): DocuSignConfigKey[] => [
  ...JWT_CREDENTIALS,
  ...(hasEnvelopes(env) ? (['templateId'] as const) : []),
];

// Validate required environment variables.
// Throws so a misconfigured server fails at startup with a clear message,
// instead of booting fine and crashing on the first request.
export const validateConfig = (env: Env = process.env): void => {
  const missing = missingDocuSignConfig(getConfig(env), requiredSettings(env));
  if (missing.length > 0) {
    throw new Error(
      `DocuSign provider: Missing required environment variables: ${missing.join(', ')}`
    );
  }
};
