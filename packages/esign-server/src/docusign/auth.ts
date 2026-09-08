// OAuth JWT grant: sign an RS256 assertion with the integration key's private
// key, exchange it for an access token, cache the token (single-flight).

import { createSign } from 'node:crypto';
import {
  DOCUSIGN_SCOPES,
  assertDocuSignConfig,
  type DocuSignConfig,
} from './config';
import { HttpError } from '../http';
import type { FetchLike } from '../types';

// Late-bound global fetch (tests replace global.fetch)
export const defaultFetch: FetchLike = (input, init) =>
  globalThis.fetch(input, init);

const base64Url = (data: string | Buffer): string =>
  Buffer.from(data).toString('base64url');

// The signed JWT assertion for the grant (1 hour, DOCUSIGN_SCOPES)
export const createJwtAssertion = (
  config: DocuSignConfig,
  now = Date.now(),
): string => {
  assertDocuSignConfig(config, ['integrationKey', 'privateKey', 'userId']);
  const issuedAt = Math.floor(now / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const payload = {
    iss: config.integrationKey,
    sub: config.userId,
    aud: config.oauthBaseUrl.replace('https://', ''),
    iat: issuedAt,
    exp: issuedAt + 3600,
    scope: DOCUSIGN_SCOPES,
  };
  const signingInput = `${base64Url(JSON.stringify(header))}.${base64Url(JSON.stringify(payload))}`;

  // JWT-grant signature (RS256), not a password hash: the payload carries the
  // OAuth host as the `aud` claim, which is why static analysis flags it.
  // codeql[js/insufficient-password-hash]
  const sign = createSign('RSA-SHA256');
  sign.update(signingInput);
  const signature = base64Url(sign.sign(config.privateKey as string));
  return `${signingInput}.${signature}`;
};

export interface TokenProvider {
  // A valid access token (cached; refreshed with a 5-minute safety margin)
  getAccessToken(): Promise<string>;
  // Forget the cached token (tests, credential rotation)
  clearTokenCache(): void;
}

// Refresh margin: a token is considered expired 5 minutes early
const EXPIRY_MARGIN_MS = 5 * 60 * 1000;

export const createTokenProvider = (
  config: DocuSignConfig,
  fetchImpl: FetchLike = defaultFetch,
): TokenProvider => {
  let cached: { token: string; expiresAt: number } | null = null;
  let inFlight: Promise<string> | null = null;

  const refresh = async (): Promise<string> => {
    const response = await fetchImpl(`${config.oauthBaseUrl}/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion: createJwtAssertion(config),
      }),
    });
    if (!response.ok) {
      throw new HttpError(response.status, await response.text());
    }
    const data = (await response.json()) as {
      access_token: string;
      expires_in: number;
    };
    cached = {
      token: data.access_token,
      expiresAt: Date.now() + data.expires_in * 1000,
    };
    return cached.token;
  };

  return {
    async getAccessToken() {
      if (cached && cached.expiresAt > Date.now() + EXPIRY_MARGIN_MS) {
        return cached.token;
      }
      // Concurrent callers share one refresh instead of each requesting a token
      if (!inFlight) {
        inFlight = refresh().finally(() => {
          inFlight = null;
        });
      }
      return inFlight;
    },
    clearTokenCache() {
      cached = null;
      inFlight = null;
    },
  };
};
