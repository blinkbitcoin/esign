// Locked terms, computed by the host.
//
// The client's prefill is intent, never a locked value: it says "10 units",
// it does not say what 10 units cost. With TERMS_URL configured, this service
// asks the host what to actually mint - POST { userId, input } with the
// caller's own bearer token forwarded (so the host can authorize the call as
// that user) and TERMS_SHARED_SECRET in x-esign-terms-secret when set - and
// the host's `{ prefill }` wins over the client's values, key by key.
//
// An envelope (ESIGN_MINT_MODE=envelope) asks the same way with the signer the
// client named beside its prefill - POST { userId, input, recipient } - and
// the host may answer `{ prefill, recipient }`: who signs is the host's to
// decide, like every value it locks.
//
// Fail closed: a non-2xx, a timeout, a non-JSON body or a reply without a
// prefill is an error, never "mint what the client sent". createESignApp
// turns that into 502 "Could not compute the signing terms".
//
// Without TERMS_URL the service mints the client's prefill as sent - fine for
// a mock/dev host and refused under ESIGN_ENV=production unless
// ESIGN_ALLOW_CLIENT_PREFILL=true says so explicitly (config.ts).

import {
  type EnvelopeAppTermsInput,
  type EnvelopeMintRequest,
  type EnvelopePrefillParser,
  type HostedFormAppPrefillInput,
  type HostedFormPrefill,
  parseEnvelopePrefill,
  type RecipientData,
} from '@blinkbitcoin/esign-node';

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

// What the host answered: a prefill object, and whatever else it said
interface TermsReply {
  prefill: HostedFormPrefill;
  recipient?: unknown;
}

const parseReply = async (response: Response): Promise<TermsReply> => {
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new TermsError('the terms callback did not answer with JSON');
  }
  const reply = body as { prefill?: unknown; recipient?: unknown } | null;
  const prefill = reply?.prefill;
  if (!prefill || typeof prefill !== 'object' || Array.isArray(prefill)) {
    throw new TermsError('the terms callback answered without a prefill object');
  }
  return { prefill: prefill as HostedFormPrefill, recipient: reply?.recipient };
};

// Ask the host: POST the payload with the caller's bearer token and the shared
// secret, and read its reply
const askHost = async (
  config: TermsConfig,
  doFetch: typeof globalThis.fetch,
  request: Request,
  payload: object
): Promise<TermsReply> => {
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
      body: JSON.stringify(payload),
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
  return parseReply(response);
};

// The prefill hook createESignApp hands to the hosted-form app: ask the
// host, lay its answer over the client's input, mint that.
export const createTermsPrefill = (
  config: TermsConfig,
  deps: TermsDeps = {}
): ((input: HostedFormAppPrefillInput) => Promise<HostedFormPrefill>) => {
  const doFetch = deps.fetch ?? globalThis.fetch;
  return async ({ userId, prefill, request }) => {
    const reply = await askHost(config, doFetch, request, { userId, input: prefill });
    return merge(prefill, reply.prefill);
  };
};

export interface EnvelopeTermsDeps extends TermsDeps {
  // What a prefill the host answers must satisfy before an envelope carries
  // it (default: DocuSign's envelope contract, as the mint checks the client's)
  parsePrefill?: EnvelopePrefillParser;
}

// A signer the host names: a name and an email, as strings
const recipientFrom = (value: unknown): RecipientData => {
  const signer = value as { name?: unknown; email?: unknown } | null;
  if (typeof signer?.name !== 'string' || typeof signer.email !== 'string') {
    throw new TermsError('the terms callback answered a recipient without a name and an email');
  }
  return { name: signer.name, email: signer.email };
};

// The terms hook createESignApp hands to the envelope app: ask the host with
// the client's signer and prefill, lay its prefill over the client's, and let
// its signer, when it names one, be the one who signs.
export const createEnvelopeTerms = (
  config: TermsConfig,
  deps: EnvelopeTermsDeps = {}
): ((input: EnvelopeAppTermsInput) => Promise<EnvelopeMintRequest>) => {
  const doFetch = deps.fetch ?? globalThis.fetch;
  const parsePrefill = deps.parsePrefill ?? parseEnvelopePrefill;
  return async ({ userId, recipient, prefill, request }) => {
    const input = prefill ?? {};
    const reply = await askHost(config, doFetch, request, { userId, input, recipient });
    const locked = parsePrefill(reply.prefill);
    if (!locked.ok) {
      throw new TermsError(`the terms callback answered an invalid prefill: ${locked.error}`);
    }
    return {
      recipient: reply.recipient === undefined ? recipient : recipientFrom(reply.recipient),
      prefill: { ...input, ...locked.prefill },
    };
  };
};
