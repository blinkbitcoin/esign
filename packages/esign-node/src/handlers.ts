// Framework-neutral HTTP handlers for the esign endpoints (the mint and the
// webhook), as Fetch API Request → Response functions: mountable as a
// serverless / route handler (Vercel, Netlify, Next.js route handlers, Lambda
// via an adapter) with no Express. The decision logic (status codes, bodies)
// lives in the `*Http` functions and is shared with the Express router.
//
// The mint exists once, over a MintKind: the Web Forms mint and the envelope
// mint are the same endpoint (401, 400 with the reason before any provider
// call, 502 when the provider fails, else 200), the same host hook, the same
// Fetch handler and the same app around a different request and a different
// provider call. Those differences are a kind's members; a third way to mint
// is a third kind, not a third copy of the stack.

import type { EnvelopeService } from './envelopes';
import { ErrorCodes, Errors, getErrorCode } from './errors';
import { consoleLogger, type Logger } from './log';
import {
  type ESignProvider,
  type HostedFormMint,
  hostedFormMint,
} from './provider';
import { renderSigningReturnBridge } from './providers/docusign/bridge';
import {
  type DocuSignMintTarget,
  mintFromDocuSign,
} from './providers/docusign/handlers';
import {
  parseEnvelopePrefill,
  parseWebFormPrefill,
} from './providers/docusign/prefill';
import { signingPageResponse } from './signingPage';
import type {
  EnvelopePrefill,
  HostedFormPrefill,
  HostedFormInstanceResult,
  RecipientData,
  WebhookHeaders,
} from './types';
import { validateRecipient } from './validation';

// An HTTP outcome, independent of the framework that sends it
export interface HttpResult {
  status: number;
  body: unknown;
}

// --- The mint, once ----------------------------------------------------------

// The mint call over a kind's input: the user, and what the request asked for
export type MintOf<TInput, TResult> = (
  userId: string,
  input: TInput,
) => Promise<TResult>;

// The outcome of reading a request body as a kind's input: the input, or the
// reason the request is refused
export type ParsedRequest<TInput> =
  | { ok: true; input: TInput }
  | { ok: false; error: string };

// A way to mint. The three members that differ between the Web Forms mint and
// the envelope mint: how a request body becomes the mint's input (the request
// parser, over the prefill parser a host may replace), and what a provider
// does with that input (the provider call). The path and the two messages
// are the kind's names for itself.
export interface MintKind<TInput extends object, TResult, TProvider, TParser> {
  // Where the endpoint lives unless the host says otherwise
  path: string;
  // The provider's prefill contract (the 400 reasons), unless the host hands
  // the handler another parser
  parsePrefill: TParser;
  // The request body as the mint's input, or the reason it is refused (400),
  // before any provider call
  parseRequest: (body: unknown, parsePrefill: TParser) => ParsedRequest<TInput>;
  // The provider call: this kind's mint over a provider, or undefined when
  // the provider cannot (→ 400 `unsupported`)
  mint: (provider: TProvider) => MintOf<TInput, TResult> | undefined;
  // The 400 for a provider that cannot mint this kind
  unsupported: string;
  // What a failed mint is logged as
  failure: string;
}

// What a mint handler mints with: a provider (the service's way), or a mint
// function (the kind's own over a provider, a package function bound to a
// configuration, or the host's own)
export type MintKindTarget<TInput, TResult, TProvider> =
  | { provider: TProvider }
  | { mint: MintOf<TInput, TResult> | undefined };

// The host's chance to decide what is actually minted, from its own data: it
// is told who is minting, the input that caller sent (already validated,
// never trusted for a locked value or for who signs) and the preset's request
// object, and returns the input the mint is called with. To reject the
// caller instead, throw `Errors.validationError(message)` (400 with the
// message) or `Errors.unauthorized()` (401); any other error is the 502.
export type MintHook<TInput extends object, TExtra extends object> = (
  input: { userId: string } & TInput & TExtra,
) => TInput | Promise<TInput>;

export interface MintInstanceHttpInput<TInput, TResult, TParser> {
  // The authenticated caller, or null (→ 401)
  userId: string | null;
  // The parsed JSON body, if any
  body: unknown;
  // How to mint for a user, or undefined when the provider cannot (→ 400)
  mint: MintOf<TInput, TResult> | undefined;
  // The prefill contract the request is held to (default: the kind's)
  parsePrefill?: TParser;
  logger?: Logger;
}

// A mint call that threw: the coded validation / authorization errors a hook
// or the provider raises keep their meaning (400 / 401, with the message);
// anything else is a failed signing session, logged by its code only.
const mintFailure = (
  error: unknown,
  logger: Logger,
  failure: string,
): HttpResult => {
  const code = getErrorCode(error);
  if (code === ErrorCodes.VALIDATION_ERROR) {
    return {
      status: 400,
      body: { error: error instanceof Error ? error.message : code },
    };
  }
  if (code === ErrorCodes.UNAUTHORIZED) {
    return { status: 401, body: { error: 'Unauthorized' } };
  }
  logger.error(failure, code);
  return { status: 502, body: { error: 'Could not create signing session' } };
};

// POST {kind.path} semantics: 401 unauthenticated, 400 when the provider
// cannot mint this kind or the request is outside the contract (with the
// reason, before any provider call), 502 when minting fails, else 200 + what
// the mint answered. A hook (mintWithHook) runs inside the same `mint` call
// this awaits, so a host rejecting the caller's own input throws
// `Errors.validationError(message)` / `Errors.unauthorized()` here too - those
// two coded errors map to 400 / 401 with the thrown message, same as the
// provider's own contract; any other error (a provider/network failure)
// still falls through to 502.
export const mintInstanceHttp = async <
  TInput extends object,
  TResult,
  TProvider,
  TParser,
>(
  kind: MintKind<TInput, TResult, TProvider, TParser>,
  input: MintInstanceHttpInput<TInput, TResult, TParser>,
): Promise<HttpResult> => {
  const logger = input.logger ?? consoleLogger;
  if (!input.userId) {
    return { status: 401, body: { error: 'Unauthorized' } };
  }
  if (!input.mint) {
    return { status: 400, body: { error: kind.unsupported } };
  }
  const parsed = kind.parseRequest(
    input.body,
    input.parsePrefill ?? kind.parsePrefill,
  );
  if (!parsed.ok) {
    return { status: 400, body: { error: parsed.error } };
  }
  try {
    return {
      status: 200,
      body: await input.mint(input.userId, parsed.input),
    };
  } catch (error) {
    return mintFailure(error, logger, kind.failure);
  }
};

// The mint a preset hands to mintInstanceHttp: the same mint, with the host's
// hook (if any) between the validated input and the provider. Unsupported
// stays unsupported (undefined → the 400 contract).
export const mintWithHook = <
  TInput extends object,
  TResult,
  TExtra extends object,
>(
  mint: MintOf<TInput, TResult> | undefined,
  hook: MintHook<TInput, TExtra> | undefined,
  extra: TExtra,
): MintOf<TInput, TResult> | undefined =>
  mint && hook
    ? async (userId, input) =>
        mint(userId, await hook({ userId, ...input, ...extra }))
    : mint;

// The mint call for a target (the Express preset resolves its target the
// same way)
export const mintOf = <TInput extends object, TResult, TProvider, TParser>(
  kind: MintKind<TInput, TResult, TProvider, TParser>,
  target: MintKindTarget<TInput, TResult, TProvider>,
): MintOf<TInput, TResult> | undefined =>
  'provider' in target ? kind.mint(target.provider) : target.mint;

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

// --- The Web Forms mint ------------------------------------------------------

// The mint call of a target: hostedFormMint(provider), or a package function
// bound to a configuration (mintFromDocuSign)
export type MintFn = HostedFormMint;

// The outcome of validating a raw prefill: the prefill, or the reason
export type ParsedPrefill =
  | { ok: true; prefill: HostedFormPrefill }
  | { ok: false; error: string };

// A provider's prefill validation (the mint's 400 contract); the default is
// DocuSign's parseWebFormPrefill
export type PrefillParser = (input: unknown) => ParsedPrefill;

// What the Web Forms mint is called with: the prefill the instance locks
export interface WebFormMintRequest {
  prefill: HostedFormPrefill;
}

// The Web Forms mint as a kind: `{ prefill }` in, the instance out. The
// public mint functions take the prefill itself (hostedFormMint,
// mintFromDocuSign), so the kind's own calls wrap and unwrap that shape.
const overPrefill = (
  mint: MintFn | undefined,
): MintOf<WebFormMintRequest, HostedFormInstanceResult> | undefined =>
  mint && ((userId, { prefill }) => mint(userId, prefill));

const byPrefill = (
  mint: MintOf<WebFormMintRequest, HostedFormInstanceResult> | undefined,
): MintFn | undefined =>
  mint && ((userId, prefill) => mint(userId, { prefill }));

export const WEB_FORM_MINT: MintKind<
  WebFormMintRequest,
  HostedFormInstanceResult,
  ESignProvider,
  PrefillParser
> = {
  path: '/webform/instance',
  parsePrefill: parseWebFormPrefill,
  parseRequest: (body, parsePrefill) => {
    const parsed = parsePrefill(
      (body as { prefill?: unknown } | undefined)?.prefill,
    );
    return parsed.ok
      ? { ok: true, input: { prefill: parsed.prefill } }
      : { ok: false, error: `Invalid prefill: ${parsed.error}` };
  },
  mint: provider => overPrefill(hostedFormMint(provider)),
  unsupported: 'Web Forms not supported by the configured provider',
  failure: 'Web Forms instance creation failed:',
};

export interface MintHttpInput {
  // The authenticated caller, or null (→ 401)
  userId: string | null;
  // The parsed JSON body, if any ({ prefill })
  body: unknown;
  // How to mint for a user, or undefined when the provider cannot (→ 400)
  mint: MintFn | undefined;
  // Validation of the raw prefill before any provider call (default:
  // DocuSign's contract - string, number, string[], phone object)
  parsePrefill?: PrefillParser;
  logger?: Logger;
}

// POST /webform/instance semantics: mintInstanceHttp over the Web Forms kind
export const mintWebFormInstanceHttp = (
  input: MintHttpInput,
): Promise<HttpResult> =>
  mintInstanceHttp(WEB_FORM_MINT, { ...input, mint: overPrefill(input.mint) });

// --- The host's prefill hook -------------------------------------------------

// What the hook is told: who is minting, and the prefill that caller sent -
// already validated, never trusted for read-only fields. Each preset adds
// its own request object (`req` on Express, `request` on Fetch).
export interface HostedFormPrefillInput {
  userId: string;
  prefill: HostedFormPrefill;
}

// The host's chance to compute the terms it locks from its own data: it
// returns the prefill that is actually minted. To reject the request
// instead (the caller's own input is out of range, say), throw
// `Errors.validationError(message)` - mintWebFormInstanceHttp maps it to
// `400 { error: message }` (or `Errors.unauthorized()` for `401`); any
// other thrown error still falls through to the generic `502`.
export type HostedFormPrefillHook<TInput extends HostedFormPrefillInput> = (
  input: TInput,
) => HostedFormPrefill | Promise<HostedFormPrefill>;

// The prefill hook as the kind's hook: the prefill it answers is the input.
// The Express preset shares it, so the public hook shape is adapted once.
export const asWebFormHook = <TExtra extends object>(
  hook: HostedFormPrefillHook<HostedFormPrefillInput & TExtra> | undefined,
): MintHook<WebFormMintRequest, TExtra> | undefined =>
  hook && (async input => ({ prefill: await hook(input) }));

// The mint a preset hands to mintWebFormInstanceHttp: the same mint, with
// the host's hook (if any) between the validated prefill and the provider.
// Unsupported stays unsupported (undefined → the 400 contract).
export const mintWithPrefillHook = <TExtra extends object>(
  mint: MintFn | undefined,
  hook: HostedFormPrefillHook<HostedFormPrefillInput & TExtra> | undefined,
  extra: TExtra,
): MintFn | undefined =>
  byPrefill(mintWithHook(overPrefill(mint), asWebFormHook(hook), extra));

// --- The envelope mint -------------------------------------------------------

// Where an envelope is minted unless the host says otherwise
export const ENVELOPE_INSTANCE_PATH = '/envelope/instance';

// What the envelope is filed under. DocuSign takes the documents from the
// template (or templates) and ignores it; the provider port asks for one
// because other providers choose the document by it.
export const ENVELOPE_CONTRACT_TYPE = 'agreement';

// What an envelope is created with: the signer, and the prefill written onto
// the signer role's tabs. An absent prefill leaves the template's own values.
export interface EnvelopeMintRequest {
  recipient?: RecipientData;
  prefill?: EnvelopePrefill;
}

// A minted envelope, answered the way a minted instance is: the URL the app
// opens, and the envelope's id (the provider's, or whatever id a host's own
// mint filed it under, a stored one say)
export interface EnvelopeInstanceResult {
  url: string;
  envelopeId: string;
}

// The envelope mint call of a target: envelopeMint(provider), or a host's own
export type EnvelopeMintFn = MintOf<
  EnvelopeMintRequest,
  EnvelopeInstanceResult
>;

// The outcome of validating a raw envelope prefill: the prefill, or the reason
export type ParsedEnvelopeMintPrefill =
  | { ok: true; prefill: EnvelopePrefill }
  | { ok: false; error: string };

// A provider's envelope prefill validation (the envelope mint's 400
// contract); the default is DocuSign's parseEnvelopePrefill
export type EnvelopePrefillParser = (
  input: unknown,
) => ParsedEnvelopeMintPrefill;

// The envelope mint over a provider. A request that ends up naming no signer
// is refused, and the signer is held to the package's name and email rules,
// before anything reaches the provider.
export const envelopeMint =
  (provider: Pick<ESignProvider, 'createEnvelope'>): EnvelopeMintFn =>
  async (userId, { recipient, prefill }) => {
    if (!recipient) {
      throw Errors.validationError(
        'recipient is required: a name and an email',
      );
    }
    const { envelopeId, signingUrl } = await provider.createEnvelope(
      userId,
      ENVELOPE_CONTRACT_TYPE,
      validateRecipient(recipient),
      prefill,
    );
    return { url: signingUrl, envelopeId };
  };

// The signer a body names, or the reason it is not one the provider could
// address. Absent is not a reason: a host's hook may name the signer, and
// the mint refuses a request that ends up with none.
const parseRecipient = (
  input: unknown,
): { ok: true; recipient?: RecipientData } | { ok: false; error: string } => {
  if (input === undefined) {
    return { ok: true };
  }
  return isPlainObject(input) &&
    typeof input.name === 'string' &&
    typeof input.email === 'string'
    ? { ok: true, recipient: { name: input.name, email: input.email } }
    : {
        ok: false,
        error: 'recipient must be an object with a name and an email',
      };
};

// The envelope mint as a kind: `{ recipient, prefill }` in (a prefill the
// caller did not send stays absent, so the template keeps its own values),
// the signing URL and the envelope id out. Every provider creates envelopes,
// so the provider call is never undefined.
export const ENVELOPE_MINT: MintKind<
  EnvelopeMintRequest,
  EnvelopeInstanceResult,
  Pick<ESignProvider, 'createEnvelope'>,
  EnvelopePrefillParser
> = {
  path: ENVELOPE_INSTANCE_PATH,
  parsePrefill: parseEnvelopePrefill,
  parseRequest: (body, parsePrefill) => {
    const request = isPlainObject(body) ? body : {};
    const recipient = parseRecipient(request.recipient);
    if (!recipient.ok) {
      return { ok: false, error: `Invalid recipient: ${recipient.error}` };
    }
    const parsed =
      request.prefill === undefined ? undefined : parsePrefill(request.prefill);
    if (parsed && !parsed.ok) {
      return { ok: false, error: `Invalid prefill: ${parsed.error}` };
    }
    return {
      ok: true,
      input: { recipient: recipient.recipient, prefill: parsed?.prefill },
    };
  },
  mint: envelopeMint,
  unsupported: 'Envelopes not supported by the configured provider',
  failure: 'Envelope creation failed:',
};

export type EnvelopeMintHttpInput = MintInstanceHttpInput<
  EnvelopeMintRequest,
  EnvelopeInstanceResult,
  EnvelopePrefillParser
>;

// POST /envelope/instance semantics: mintInstanceHttp over the envelope kind
export const mintEnvelopeInstanceHttp = (
  input: EnvelopeMintHttpInput,
): Promise<HttpResult> => mintInstanceHttp(ENVELOPE_MINT, input);

// What an envelope hook is told: who is minting, and the signer and prefill
// that caller sent - already validated, never trusted for who signs or for a
// locked value. Each preset adds its own request object.
export interface EnvelopeTermsInput extends EnvelopeMintRequest {
  userId: string;
}

// The host's chance to decide who signs and what the envelope locks, from its
// own data: it returns the request the envelope is actually created with. To
// reject the caller instead, throw `Errors.validationError(message)` (400) or
// `Errors.unauthorized()` (401), as with the Web Forms prefill hook.
export type EnvelopeTermsHook<TInput extends EnvelopeTermsInput> = (
  input: TInput,
) => EnvelopeMintRequest | Promise<EnvelopeMintRequest>;

// --- Webhook -----------------------------------------------------------------

export interface WebhookHttpInput {
  provider: Pick<ESignProvider, 'verifyWebhook' | 'parseWebhookEvent'>;
  envelopes: Pick<EnvelopeService, 'handleWebhookEvent'>;
  headers: WebhookHeaders;
  // The exact bytes received (re-serializing would change the signature)
  rawBody: string;
  ip?: string;
  logger?: Logger;
}

// POST /webhook/esign semantics: 401 on a bad signature, 400 on an
// unparseable payload, 500 when processing fails (the provider retries; the
// handler is idempotent), else 200 { received: true }
export const processWebhookHttp = async (
  input: WebhookHttpInput,
): Promise<HttpResult> => {
  const logger = input.logger ?? consoleLogger;
  if (!input.provider.verifyWebhook(input.headers, input.rawBody, input.ip)) {
    return { status: 401, body: { error: 'Unauthorized' } };
  }
  const event = input.provider.parseWebhookEvent(input.rawBody);
  if (!event) {
    logger.error('Webhook error: Invalid payload');
    return { status: 400, body: { error: 'Invalid payload' } };
  }
  try {
    await input.envelopes.handleWebhookEvent(event);
    return { status: 200, body: { received: true } };
  } catch (error) {
    logger.error(
      'Webhook processing error:',
      error instanceof Error ? error.message : error,
    );
    return { status: 500, body: { error: 'Processing failed' } };
  }
};

// --- Fetch API handlers ------------------------------------------------------

const json = (result: HttpResult): Response =>
  new Response(JSON.stringify(result.body), {
    status: result.status,
    headers: { 'content-type': 'application/json' },
  });

// A body that is not JSON (an empty body is fine: it means no prefill)
const INVALID_JSON = Symbol('invalid json');

const readJson = async (request: Request): Promise<unknown> => {
  const text = await request.text();
  if (!text) {
    return undefined;
  }
  try {
    return JSON.parse(text);
  } catch {
    return INVALID_JSON;
  }
};

const headersOf = (request: Request): WebhookHeaders => {
  const headers: WebhookHeaders = {};
  request.headers.forEach((value, key) => {
    headers[key] = value;
  });
  return headers;
};

export interface MintHandlerOptions<TParser> {
  // The host's authentication: the caller's user id, or null (→ 401)
  authenticate: (request: Request) => string | null | Promise<string | null>;
  // The prefill contract the request is held to (default: the kind's)
  parsePrefill?: TParser;
  logger?: Logger;
}

// POST {kind.path} as a Fetch API handler, for any provider: the JSON body
// (400 when it is not JSON), then the kind's decision
export const createMintHandler = <
  TInput extends object,
  TResult,
  TProvider,
  TParser,
>(
  kind: MintKind<TInput, TResult, TProvider, TParser>,
  options: MintKindTarget<TInput, TResult, TProvider> &
    MintHandlerOptions<TParser>,
): ((request: Request) => Promise<Response>) => {
  const mint = mintOf(kind, options);
  return async request => {
    const body = await readJson(request);
    if (body === INVALID_JSON) {
      return json({ status: 400, body: { error: 'Invalid JSON body' } });
    }
    return json(
      await mintInstanceHttp(kind, {
        userId: await options.authenticate(request),
        body,
        mint,
        parsePrefill: options.parsePrefill,
        logger: options.logger,
      }),
    );
  };
};

// What a Web Forms mint handler mints with: a provider (the service's way),
// or a mint function (hostedFormMint(provider), mintFromDocuSign(config),
// your own)
export type MintTarget =
  | { provider: ESignProvider }
  | { mint: MintFn | undefined };

// The Web Forms target as the kind's: the public mint takes the prefill
// itself. The Express preset shares it, so the public target is adapted once.
export const webFormTarget = (
  target: MintTarget,
): MintKindTarget<
  WebFormMintRequest,
  HostedFormInstanceResult,
  ESignProvider
> => ('provider' in target ? target : { mint: overPrefill(target.mint) });

export type HostedFormHandlerOptions = MintHandlerOptions<PrefillParser>;

export type HostedFormInstanceHandlerOptions = MintTarget &
  HostedFormHandlerOptions;

// createWebFormInstanceHandler also takes DocuSign's own target: a config
// or a client, the serverless way
export type WebFormInstanceHandlerOptions = (MintTarget | DocuSignMintTarget) &
  HostedFormHandlerOptions;

// POST /webform/instance as a Fetch API handler, for any provider
export const createHostedFormInstanceHandler = (
  options: HostedFormInstanceHandlerOptions,
): ((request: Request) => Promise<Response>) =>
  createMintHandler(WEB_FORM_MINT, { ...options, ...webFormTarget(options) });

// POST /webform/instance as a Fetch API handler: a provider, a mint
// function, or straight from a DocuSign config / client
export const createWebFormInstanceHandler = (
  options: WebFormInstanceHandlerOptions,
): ((request: Request) => Promise<Response>) =>
  createHostedFormInstanceHandler(
    'provider' in options || 'mint' in options
      ? options
      : { ...options, mint: mintFromDocuSign(options) },
  );

// What an envelope mint handler mints with: a provider (the service's way),
// or an envelope mint function (a host's own)
export type EnvelopeMintTarget = MintKindTarget<
  EnvelopeMintRequest,
  EnvelopeInstanceResult,
  Pick<ESignProvider, 'createEnvelope'>
>;

export type EnvelopeHandlerOptions = MintHandlerOptions<EnvelopePrefillParser>;

export type EnvelopeInstanceHandlerOptions = EnvelopeMintTarget &
  EnvelopeHandlerOptions;

// POST /envelope/instance as a Fetch API handler, for any provider
export const createEnvelopeInstanceHandler = (
  options: EnvelopeInstanceHandlerOptions,
): ((request: Request) => Promise<Response>) =>
  createMintHandler(ENVELOPE_MINT, options);

export interface WebhookHandlerOptions {
  provider: Pick<ESignProvider, 'verifyWebhook' | 'parseWebhookEvent'>;
  envelopes: Pick<EnvelopeService, 'handleWebhookEvent'>;
  // The client IP for security logging (platform-specific; e.g. a header)
  clientIp?: (request: Request) => string | undefined;
  logger?: Logger;
}

// POST /webhook/esign as a Fetch API handler
export const createWebhookHandler = (
  options: WebhookHandlerOptions,
): ((request: Request) => Promise<Response>) => {
  return async request =>
    json(
      await processWebhookHttp({
        provider: options.provider,
        envelopes: options.envelopes,
        headers: headersOf(request),
        rawBody: await request.text(),
        ip: options.clientIp?.(request),
        logger: options.logger,
      }),
    );
};

// --- The mint app (a whole Fetch surface, not one handler) -------------------

export interface HostedFormAppCors {
  // The origins allowed to call the mint endpoint from a browser; '*'
  // allows any
  origins: string[];
}

// A whole HTTP surface behind one Fetch entry point - what a Vercel route,
// a Worker or a Node server exports
export interface HostedFormApp {
  fetch: (request: Request) => Promise<Response>;
}

const RETURN_PATH = '/signing/return';
const HEALTH_PATH = '/health';

// The CORS response headers for this request: the allowed origin echoed
// back (or '*'), nothing but the Vary for an origin the host did not allow.
// Every answer a configured CORS policy produces varies on Origin, so a
// shared cache cannot serve the header-less one to an allowed origin.
const corsHeaders = (
  cors: HostedFormAppCors | undefined,
  request: Request,
): Record<string, string> => {
  if (!cors) {
    return {};
  }
  const vary = { vary: 'origin' };
  const origin = request.headers.get('origin');
  if (!origin) {
    return vary;
  }
  if (cors.origins.includes('*')) {
    return { ...vary, 'access-control-allow-origin': '*' };
  }
  return cors.origins.includes(origin)
    ? { ...vary, 'access-control-allow-origin': origin }
    : vary;
};

const withHeaders = (response: Response, headers: Record<string, string>) => {
  for (const [key, value] of Object.entries(headers)) {
    response.headers.set(key, value);
  }
  return response;
};

// What the Fetch surface takes besides its target; the named presets derive
// their options from this, so the shared fields exist once
export type MintAppSurfaceOptions<
  TInput extends object,
  TParser,
> = MintHandlerOptions<TParser> & {
  // The host's hook between the validated request and the provider, told
  // the Fetch Request behind the request
  hook?: MintHook<TInput, { request: Request }>;
  // Where the mint endpoint lives (default: the kind's path)
  path?: string;
  // Serve GET /health (default true)
  health?: boolean;
  // Answer the CORS preflight and mark the mint response (default: no CORS)
  cors?: HostedFormAppCors;
};

export type MintAppOptions<
  TInput extends object,
  TResult,
  TProvider,
  TParser,
> = MintKindTarget<TInput, TResult, TProvider> &
  MintAppSurfaceOptions<TInput, TParser>;

// The mint endpoint's own surface, for any kind: POST {path} to mint, the
// return-URL bridge the signer comes back to, a health check, and the CORS
// preflight when the host configured origins. Everything else is 404. The
// Express preset (createMintRouter) shares its decisions: both go through
// mintInstanceHttp and the same hook.
export const createMintApp = <
  TInput extends object,
  TResult,
  TProvider,
  TParser,
>(
  kind: MintKind<TInput, TResult, TProvider, TParser>,
  options: MintAppOptions<TInput, TResult, TProvider, TParser>,
): HostedFormApp => {
  const path = options.path ?? kind.path;
  const health = options.health ?? true;
  const mint = mintOf(kind, options);
  return {
    fetch: async request => {
      const { pathname, searchParams } = new URL(request.url);
      const cors = corsHeaders(options.cors, request);

      if (options.cors && request.method === 'OPTIONS' && pathname === path) {
        return new Response(null, {
          status: 204,
          headers: {
            ...cors,
            'access-control-allow-methods': 'POST, OPTIONS',
            'access-control-allow-headers': 'authorization, content-type',
            'access-control-max-age': '86400',
          },
        });
      }

      if (request.method === 'POST' && pathname === path) {
        const handler = createMintHandler(kind, {
          mint: mintWithHook(mint, options.hook, { request }),
          authenticate: options.authenticate,
          parsePrefill: options.parsePrefill,
          logger: options.logger,
        });
        return withHeaders(await handler(request), cors);
      }

      if (request.method === 'GET' && pathname === RETURN_PATH) {
        const event = searchParams.get('event') ?? undefined;
        return signingPageResponse(nonce =>
          renderSigningReturnBridge(event, nonce),
        );
      }

      if (health && request.method === 'GET' && pathname === HEALTH_PATH) {
        return json({
          status: 200,
          body: { status: 'ok', timestamp: new Date().toISOString() },
        });
      }

      return json({ status: 404, body: { error: 'Not found' } });
    },
  };
};

// What the Fetch preset's prefill hook is told: the caller, the prefill that
// caller sent (validated), and the Fetch Request behind it
export interface HostedFormAppPrefillInput extends HostedFormPrefillInput {
  request: Request;
}

// The surface options with the Web Forms hook in the public shape: the
// prefill itself in, the prefill actually minted out
export type HostedFormAppOptions = MintTarget &
  Omit<MintAppSurfaceOptions<WebFormMintRequest, PrefillParser>, 'hook'> & {
    // The host's chance to compute the terms it locks from its own data: it
    // receives the caller's validated prefill and returns the prefill that is
    // actually minted. Client values are input, never trusted for read-only
    // fields.
    prefill?: HostedFormPrefillHook<HostedFormAppPrefillInput>;
  };

// The Web Forms mint as a whole Fetch surface: createMintApp over its kind
export const createHostedFormApp = (
  options: HostedFormAppOptions,
): HostedFormApp =>
  createMintApp(WEB_FORM_MINT, {
    ...options,
    ...webFormTarget(options),
    hook: asWebFormHook<{ request: Request }>(options.prefill),
  });

// What the Fetch envelope preset's terms hook is told: the caller, the signer
// and prefill that caller sent (validated), and the Fetch Request behind them
export interface EnvelopeAppTermsInput extends EnvelopeTermsInput {
  request: Request;
}

// The surface options with the envelope hook under its own name
export type EnvelopeAppOptions = EnvelopeMintTarget &
  Omit<
    MintAppSurfaceOptions<EnvelopeMintRequest, EnvelopePrefillParser>,
    'hook'
  > & {
    // The host's chance to decide who signs and what the envelope locks, from
    // its own data: it receives the caller's validated request and returns
    // the one the envelope is created with. Client values are input, never
    // trusted for the signer or for a locked value.
    terms?: EnvelopeTermsHook<EnvelopeAppTermsInput>;
  };

// The envelope mint as a whole Fetch surface: createMintApp over its kind
export const createEnvelopeApp = (options: EnvelopeAppOptions): HostedFormApp =>
  createMintApp(ENVELOPE_MINT, { ...options, hook: options.terms });
