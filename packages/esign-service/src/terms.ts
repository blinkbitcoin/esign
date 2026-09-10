// Locked terms, computed by the host.
//
// The client's prefill is intent, never a locked value: it says "10 units",
// it does not say what 10 units cost. With TERMS_URL configured, this service
// asks the host what to actually mint - POST { userId, input } with the
// caller's own bearer token forwarded (so the host can authorize the call as
// that user) and TERMS_SHARED_SECRET in x-esign-terms-secret when set - and
// the host's `{ prefill }` wins over the client's values, key by key.
//
// Fail closed: a non-2xx, a timeout, a non-JSON body or a reply without a
// prefill is an error, never "mint what the client sent". createESignApp
// turns that into 502 "Could not compute the signing terms".
//
// Without TERMS_URL the service mints the client's prefill as sent - fine for
// a mock/dev host and refused under ESIGN_ENV=production unless
// ESIGN_ALLOW_CLIENT_PREFILL=true says so explicitly (config.ts).

import type { HostedFormAppPrefillInput, HostedFormPrefill } from '@blinkbitcoin/esign-node';

import type { Env } from './env';

export const TERMS_URL = 'TERMS_URL';
export const TERMS_SHARED_SECRET = 'TERMS_SHARED_SECRET';
export const TERMS_TIMEOUT_MS = 'TERMS_TIMEOUT_MS';

// The header the shared secret travels in
export const TERMS_SECRET_HEADER = 'x-esign-terms-secret';

export const DEFAULT_TERMS_TIMEOUT_MS = 5000;

// What the mint answers when the terms could not be computed. The client
// asked for something the host could not price - not a signing failure.
export const TERMS_FAILURE_MESSAGE = 'Could not compute the signing terms';

export interface TermsConfig {
  // Where to ask
  url: string;
  // Sent as x-esign-terms-secret when set, so the host can tell this service
  // apart from anything else that reaches the callback
  secret?: string;
  timeoutMs: number;
}

// The terms callback could not answer: everything the caller needs to know
// is that the terms are unavailable, so the message is the same either way.
export class TermsError extends Error {
  constructor(readonly reason: string) {
    super(TERMS_FAILURE_MESSAGE);
    this.name = 'TermsError';
  }
}

// The callback this environment configures, or undefined when it configures
// none (the client's prefill is minted as sent)
export const termsConfigFromEnv = (env: Env): TermsConfig | undefined => {
  const url = env[TERMS_URL];
  if (!url) {
    return undefined;
  }
  const timeout = Number(env[TERMS_TIMEOUT_MS]);
  return {
    url,
    secret: env[TERMS_SHARED_SECRET],
    timeoutMs: Number.isFinite(timeout) && timeout > 0 ? timeout : DEFAULT_TERMS_TIMEOUT_MS,
  };
};

export interface TermsDeps {
  // The fetch used for the callback (default: the platform's)
  fetch?: typeof globalThis.fetch;
}

// The prefill actually minted: the client's input with the host's answer
// laid over it, key by key.
const merge = (input: HostedFormPrefill, locked: HostedFormPrefill): HostedFormPrefill => ({
  ...input,
  ...locked,
});

const parsePrefill = async (response: Response): Promise<HostedFormPrefill> => {
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new TermsError('the terms callback did not answer with JSON');
  }
  const prefill = (body as { prefill?: unknown } | null)?.prefill;
  if (!prefill || typeof prefill !== 'object' || Array.isArray(prefill)) {
    throw new TermsError('the terms callback answered without a prefill object');
  }
  return prefill as HostedFormPrefill;
};

// The prefill hook createESignApp hands to the hosted-form app: ask the
// host, lay its answer over the client's input, mint that.
export const createTermsPrefill = (
  config: TermsConfig,
  deps: TermsDeps = {}
): ((input: HostedFormAppPrefillInput) => Promise<HostedFormPrefill>) => {
  const doFetch = deps.fetch ?? globalThis.fetch;
  return async ({ userId, prefill, request }) => {
    const authorization = request.headers.get('authorization');
    let response: Response;
    try {
      response = await doFetch(config.url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(authorization ? { authorization } : {}),
          ...(config.secret ? { [TERMS_SECRET_HEADER]: config.secret } : {}),
        },
        body: JSON.stringify({ userId, input: prefill }),
        signal: AbortSignal.timeout(config.timeoutMs),
      });
    } catch (error) {
      throw new TermsError(
        `the terms callback did not answer: ${error instanceof Error ? error.message : String(error)}`
      );
    }
    if (!response.ok) {
      throw new TermsError(`the terms callback answered ${response.status}`);
    }
    return merge(prefill, await parsePrefill(response));
  };
};
