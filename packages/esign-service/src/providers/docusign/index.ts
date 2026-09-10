// The DocuSign adapter for the service: the package's adapter over the
// service's configuration and webhook policy (ALLOW_INSECURE_DEV allows
// unsigned webhooks; DOCUSIGN_HMAC_KEY is read per call so rotation and
// tests see the current environment).

import { createDocuSignProvider } from '@blinkbitcoin/esign-node';
import { type Env, isInsecureDevAllowed } from '../../env';
import { getConfig } from './config';

// The adapter over one environment. Values are read per call, so credential
// rotation (and a test changing process.env) is seen without a rebuild.
export const createProvider = (env: Env = process.env) =>
  createDocuSignProvider({
    config: () => getConfig(env),
    webhook: {
      hmacKey: () => env.DOCUSIGN_HMAC_KEY,
      allowMissingKey: () => isInsecureDevAllowed(env),
    },
  });

const handle = createProvider();

export const DocuSignProvider = handle;

// Forget the client and its cached token (tests, credential rotation)
export const clearTokenCache = (): void => handle.reset();

export type { DocuSignWebhookPayload } from '@blinkbitcoin/esign-node';
// Re-exports: the package's testable utilities (imported by tests), config
// validation (used by the factory) and the webhook payload type.
export {
  HttpError,
  RETRY_CONFIG,
  shouldRetry,
  sleep,
  withRetry,
} from '@blinkbitcoin/esign-node';
export { validateConfig } from './config';
