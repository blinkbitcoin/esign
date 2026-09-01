// Centralized security configuration and fail-fast boot validation.
//
// The security posture is enforced at STARTUP, not inferred per-request from
// NODE_ENV. A server that lacks the secrets it needs must refuse to start
// (fail-closed) rather than silently trusting clients.
//
// Local development that intentionally runs without secrets must opt in
// explicitly with ALLOW_INSECURE_DEV=true - a deliberate, greppable flag that
// cannot be triggered by a missing/typo'd NODE_ENV.

// True only when the operator has explicitly allowed running without the
// security secrets (local dev, E2E, CI against the mock provider).
export const isInsecureDevAllowed = (env: NodeJS.ProcessEnv = process.env): boolean =>
  env.ALLOW_INSECURE_DEV === 'true';

// Auth uses JWT verification unless insecure-dev is explicitly allowed.
export const isJwtRequired = (env: NodeJS.ProcessEnv = process.env): boolean =>
  !isInsecureDevAllowed(env);

// Webhooks require signature verification unless insecure-dev is allowed AND
// no key is configured (mock-provider local runs).
export const isWebhookSignatureRequired = (env: NodeJS.ProcessEnv = process.env): boolean =>
  !isInsecureDevAllowed(env);

// Validate the security configuration at boot. Throws (fail to start) when a
// required secret is missing and insecure-dev has not been explicitly allowed.
//
// Called from server startup BEFORE the app accepts connections.
export const validateSecurityConfig = (env: NodeJS.ProcessEnv = process.env): void => {
  if (isInsecureDevAllowed(env)) {
    console.warn(
      '⚠️  ALLOW_INSECURE_DEV=true - JWT and webhook signature verification may be bypassed. NEVER set this in production.'
    );
    return;
  }

  const missing: string[] = [];

  if (!env.JWT_SECRET) {
    missing.push('JWT_SECRET (or set ALLOW_INSECURE_DEV=true for local dev)');
  }

  // The webhook secret is only meaningful for a real provider; the mock
  // provider has no inbound signatures to verify.
  if ((env.ESIGN_PROVIDER ?? 'mock') === 'docusign' && !env.DOCUSIGN_HMAC_KEY) {
    missing.push('DOCUSIGN_HMAC_KEY (or set ALLOW_INSECURE_DEV=true for local dev)');
  }

  if (missing.length > 0) {
    throw new Error(
      `Refusing to start: missing required security configuration: ${missing.join(', ')}`
    );
  }
};

// Allowed CORS origins from CORS_ALLOWED_ORIGINS (comma-separated).
// Empty => same-origin only (no cross-origin browser access). This replaces
// the previous wildcard-reflecting default.
export const getAllowedOrigins = (env: NodeJS.ProcessEnv = process.env): string[] =>
  (env.CORS_ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
