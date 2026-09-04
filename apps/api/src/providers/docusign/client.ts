// DocuSign HTTP client: JWT/OAuth auth (+ token cache), retry/backoff, and the
// REST calls. The adapter (index.ts) composes these; this file is the only place
// that talks to DocuSign over the wire.

import { createSign } from 'crypto';
import type { RecipientData, WebFormInstanceResult, WebFormPrefill } from '../../types';
import { getConfig } from './config';

// --- Errors + retry ---------------------------------------------------------

// Custom error class for HTTP errors
export class HttpError extends Error {
  constructor(
    public status: number,
    public body: string
  ) {
    super(`HTTP ${status}: ${body}`);
    this.name = 'HttpError';
  }
}

// Retry configuration
export const RETRY_CONFIG = {
  maxAttempts: 3,
  baseDelay: 1000, // 1s, 2s, 4s exponential backoff
};

// Non-retryable client error (4xx excluding 429, which is transient)
export const isClientError = (error: unknown): boolean =>
  error instanceof HttpError && error.status >= 400 && error.status < 500 && error.status !== 429;

// Not-found error (404)
export const isNotFoundError = (error: unknown): boolean =>
  error instanceof HttpError && error.status === 404;

// Whether an error should be retried
export const shouldRetry = (error: unknown): boolean => {
  // Retry on network errors (not HttpError)
  if (!(error instanceof HttpError)) {
    return true;
  }
  // Retry on 5xx and 429 rate limits
  if (error.status >= 500) {
    return true;
  }
  if (error.status === 429) {
    return true;
  }
  // Don't retry on other 4xx errors
  return false;
};

// Sleep utility for retry delays
export const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

// Exponential backoff retry wrapper
export const withRetry = async <T>(fn: () => Promise<T>, config = RETRY_CONFIG): Promise<T> => {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < config.maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;
      if (!shouldRetry(error)) {
        throw error;
      }
      if (attempt < config.maxAttempts - 1) {
        const delay = config.baseDelay * Math.pow(2, attempt);
        await sleep(delay);
      }
    }
  }

  throw lastError;
};

// --- Auth (JWT Grant) -------------------------------------------------------

// Token cache with race-condition protection
let cachedAccessToken: { token: string; expiresAt: number } | null = null;
let tokenRefreshPromise: Promise<string> | null = null;

// Base64URL encode (JWT-safe encoding)
const base64UrlEncode = (data: string): string =>
  Buffer.from(data).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

// Create JWT assertion for OAuth using RS256 signing
const createJwtAssertion = (integrationKey: string, privateKey: string, userId: string): string => {
  const config = getConfig();
  const now = Math.floor(Date.now() / 1000);

  const header = { alg: 'RS256', typ: 'JWT' };
  const payload = {
    iss: integrationKey,
    sub: userId,
    aud: config.oauthBaseUrl.replace('https://', ''),
    iat: now,
    exp: now + 3600, // 1 hour expiry
    scope: 'signature impersonation',
  };

  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const signingInput = `${encodedHeader}.${encodedPayload}`;

  // JWT-grant signature (RS256), not a password hash: the payload carries the
  // OAuth host as the `aud` claim, which is why static analysis flags it.
  const sign = createSign('RSA-SHA256');
  sign.update(signingInput);
  const signature = sign
    .sign(privateKey, 'base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

  return `${signingInput}.${signature}`;
};

// Actual token refresh logic
const refreshAccessToken = async (): Promise<string> => {
  const config = getConfig();

  const response = await fetch(`${config.oauthBaseUrl}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: createJwtAssertion(config.integrationKey!, config.privateKey!, config.userId!),
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new HttpError(response.status, body);
  }

  const data = (await response.json()) as { access_token: string; expires_in: number };
  cachedAccessToken = {
    token: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  };
  return cachedAccessToken.token;
};

// Get access token using JWT Grant flow (cached, single-flight)
export const getAccessToken = async (): Promise<string> => {
  // Return cached token if still valid (with 5 min buffer)
  if (cachedAccessToken && cachedAccessToken.expiresAt > Date.now() + 5 * 60 * 1000) {
    return cachedAccessToken.token;
  }
  // If another request is already refreshing the token, wait for it
  if (tokenRefreshPromise) {
    return tokenRefreshPromise;
  }
  tokenRefreshPromise = refreshAccessToken();
  try {
    return await tokenRefreshPromise;
  } finally {
    tokenRefreshPromise = null;
  }
};

// Clear token cache (for testing)
export const clearTokenCache = (): void => {
  cachedAccessToken = null;
  tokenRefreshPromise = null;
};

// --- REST calls -------------------------------------------------------------

// clientUserId for embedded signing (must match between envelope creation and
// the view request); DocuSign requires it to match exactly.
const generateClientUserId = (email: string): string => email;

// Create envelope from template
export const createEnvelopeFromTemplate = async (
  accessToken: string,
  recipient: RecipientData
): Promise<{ envelopeId: string }> => {
  const config = getConfig();
  const clientUserId = generateClientUserId(recipient.email);

  const response = await fetch(`${config.apiBaseUrl}/v2.1/accounts/${config.accountId}/envelopes`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      templateId: config.templateId,
      templateRoles: [
        {
          email: recipient.email,
          name: recipient.name,
          roleName: 'signer',
          clientUserId, // Required for embedded signing
        },
      ],
      status: 'sent',
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    console.error(`DocuSign envelope creation failed: HTTP ${response.status}`);
    throw new HttpError(response.status, body);
  }

  const data = (await response.json()) as { envelopeId: string };
  return { envelopeId: data.envelopeId };
};

// Create a DocuSign Web Forms instance and return its embeddable URL.
// POST {webFormsBaseUrl}/accounts/{accountId}/forms/{formId}/instances
// Verified against the Web Forms API reference (2026-07):
//   - base path https://apps-d.docusign.com/api/webforms/v1.1 (demo)
//   - body { clientUserId (REQUIRED, <=100 chars), formValues } - formValues
//     keys are the form's field API reference names (componentNames)
//   - returns { formUrl, instanceToken }; instanceToken expires in ~5 min and
//     is embedded in the URL fragment.
export const createWebFormInstanceRequest = async (
  accessToken: string,
  clientUserId: string,
  prefill: WebFormPrefill
): Promise<WebFormInstanceResult> => {
  const config = getConfig();

  const response = await fetch(
    `${config.webFormsBaseUrl}/accounts/${config.accountId}/forms/${config.webFormId}/instances`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ clientUserId, formValues: prefill }),
    }
  );

  if (!response.ok) {
    const body = await response.text();
    console.error(`DocuSign Web Forms instance creation failed: HTTP ${response.status}`);
    throw new HttpError(response.status, body);
  }

  const data = (await response.json()) as { formUrl: string; instanceToken: string; id?: string };
  return {
    url: `${data.formUrl}#instanceToken=${data.instanceToken}`,
    instanceId: data.id,
  };
};

// Get embedded signing URL
export const getEmbeddedSigningUrl = async (
  accessToken: string,
  envelopeId: string,
  recipient: RecipientData
): Promise<string> => {
  const config = getConfig();
  const clientUserId = generateClientUserId(recipient.email);

  const response = await fetch(
    `${config.apiBaseUrl}/v2.1/accounts/${config.accountId}/envelopes/${envelopeId}/views/recipient`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        returnUrl: config.returnUrl,
        authenticationMethod: 'none',
        email: recipient.email,
        userName: recipient.name,
        clientUserId, // Must match the value used when creating the envelope
      }),
    }
  );

  if (!response.ok) {
    const body = await response.text();
    console.error(`DocuSign signing URL request failed: HTTP ${response.status}`);
    throw new HttpError(response.status, body);
  }

  const data = (await response.json()) as { url: string };
  return data.url;
};

// Fetch envelope status
export const fetchEnvelopeStatus = async (
  accessToken: string,
  envelopeId: string
): Promise<{ status: string }> => {
  const config = getConfig();

  const response = await fetch(
    `${config.apiBaseUrl}/v2.1/accounts/${config.accountId}/envelopes/${envelopeId}`,
    {
      method: 'GET',
      headers: { Authorization: `Bearer ${accessToken}` },
    }
  );

  if (!response.ok) {
    const body = await response.text();
    console.error(`DocuSign envelope status request failed: HTTP ${response.status}`);
    throw new HttpError(response.status, body);
  }

  const data = (await response.json()) as { status: string };
  return { status: data.status };
};
