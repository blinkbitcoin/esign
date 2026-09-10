// Framework-neutral HTTP handlers for the two esign endpoints, as Fetch API
// Request → Response functions: mountable as a serverless / route handler
// (Vercel, Netlify, Next.js route handlers, Lambda via an adapter) with no
// Express. The decision logic (status codes, bodies) lives in the two
// `*Http` functions and is shared with the Express router.

import type { EnvelopeService } from './envelopes';
import { getErrorCode } from './errors';
import { consoleLogger, type Logger } from './log';
import {
  type ESignProvider,
  type HostedFormMint,
  hostedFormMint,
} from './provider';
import {
  type DocuSignMintTarget,
  mintFromDocuSign,
} from './providers/docusign/handlers';
import { renderSigningReturnBridge } from './providers/docusign/bridge';
import { parseWebFormPrefill } from './providers/docusign/prefill';
import { signingPageResponse } from './signingPage';
import type { HostedFormPrefill, WebhookHeaders } from './types';

// An HTTP outcome, independent of the framework that sends it
export interface HttpResult {
  status: number;
  body: unknown;
}

// --- Mint --------------------------------------------------------------------

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

// POST /webform/instance semantics: 401 unauthenticated, 400 when hosted
// forms are unsupported or the prefill is outside the contract (with the
// reason, before any provider call), 502 when minting fails, else 200 + the
// instance
export const mintWebFormInstanceHttp = async (
  input: MintHttpInput,
): Promise<HttpResult> => {
  const logger = input.logger ?? consoleLogger;
  if (!input.userId) {
    return { status: 401, body: { error: 'Unauthorized' } };
  }
  if (!input.mint) {
    return {
      status: 400,
      body: { error: 'Web Forms not supported by the configured provider' },
    };
  }
  const parsed = (input.parsePrefill ?? parseWebFormPrefill)(
    (input.body as { prefill?: unknown } | undefined)?.prefill,
  );
  if (!parsed.ok) {
    return { status: 400, body: { error: `Invalid prefill: ${parsed.error}` } };
  }
  try {
    return {
      status: 200,
      body: await input.mint(input.userId, parsed.prefill),
    };
  } catch (error) {
    logger.error('Web Forms instance creation failed:', getErrorCode(error));
    return { status: 502, body: { error: 'Could not create signing session' } };
  }
};

// --- The host's prefill hook -------------------------------------------------

// What the hook is told: who is minting, and the prefill that caller sent -
// already validated, never trusted for read-only fields. Each preset adds
// its own request object (`req` on Express, `request` on Fetch).
export interface HostedFormPrefillInput {
  userId: string;
  prefill: HostedFormPrefill;
}

// The host's chance to compute the terms it locks from its own data: it
// returns the prefill that is actually minted
export type HostedFormPrefillHook<TInput extends HostedFormPrefillInput> = (
  input: TInput,
) => HostedFormPrefill | Promise<HostedFormPrefill>;

// The mint a preset hands to mintWebFormInstanceHttp: the same mint, with
// the host's hook (if any) between the validated prefill and the provider.
// Unsupported stays unsupported (undefined → the 400 contract).
export const mintWithPrefillHook = <TExtra extends object>(
  mint: MintFn | undefined,
  hook: HostedFormPrefillHook<HostedFormPrefillInput & TExtra> | undefined,
  extra: TExtra,
): MintFn | undefined =>
  mint && hook
    ? async (userId, prefill) =>
        mint(userId, await hook({ userId, prefill, ...extra }))
    : mint;

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

// What a mint handler mints with: a provider (the service's way), or a mint
// function (hostedFormMint(provider), mintFromDocuSign(config), your own)
export type MintTarget =
  | { provider: ESignProvider }
  | { mint: MintFn | undefined };

export interface HostedFormHandlerOptions {
  // The host's authentication: the caller's user id, or null (→ 401)
  authenticate: (request: Request) => string | null | Promise<string | null>;
  // The provider's prefill validation (default: DocuSign's)
  parsePrefill?: PrefillParser;
  logger?: Logger;
}

export type HostedFormInstanceHandlerOptions = MintTarget &
  HostedFormHandlerOptions;

// createWebFormInstanceHandler also takes DocuSign's own target: a config
// or a client, the serverless way
export type WebFormInstanceHandlerOptions = (MintTarget | DocuSignMintTarget) &
  HostedFormHandlerOptions;

// The mint call for a neutral target
const mintFor = (target: MintTarget): MintFn | undefined =>
  'provider' in target ? hostedFormMint(target.provider) : target.mint;

// POST /webform/instance as a Fetch API handler, for any provider
export const createHostedFormInstanceHandler = (
  options: HostedFormInstanceHandlerOptions,
): ((request: Request) => Promise<Response>) => {
  const mint = mintFor(options);
  return async request => {
    const body = await readJson(request);
    if (body === INVALID_JSON) {
      return json({ status: 400, body: { error: 'Invalid JSON body' } });
    }
    return json(
      await mintWebFormInstanceHttp({
        userId: await options.authenticate(request),
        body,
        mint,
        parsePrefill: options.parsePrefill,
        logger: options.logger,
      }),
    );
  };
};

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

// --- The hosted-form app (a whole Fetch surface, not one handler) ------------

// What the Fetch preset's prefill hook is told: the caller, the prefill that
// caller sent (validated), and the Fetch Request behind it
export interface HostedFormAppPrefillInput extends HostedFormPrefillInput {
  request: Request;
}

export interface HostedFormAppCors {
  // The origins allowed to call the mint endpoint from a browser; '*'
  // allows any
  origins: string[];
}

export type HostedFormAppOptions = MintTarget & {
  // The host's authentication: the caller's user id, or null (→ 401)
  authenticate: (request: Request) => string | null | Promise<string | null>;
  // The host's chance to compute the terms it locks from its own data: it
  // receives the caller's validated prefill and returns the prefill that is
  // actually minted. Client values are input, never trusted for read-only
  // fields.
  prefill?: HostedFormPrefillHook<HostedFormAppPrefillInput>;
  // Where the mint endpoint lives (default /webform/instance)
  path?: string;
  // Serve GET /health (default true)
  health?: boolean;
  // Answer the CORS preflight and mark the mint response (default: no CORS)
  cors?: HostedFormAppCors;
  // The provider's prefill validation (default: DocuSign's)
  parsePrefill?: PrefillParser;
  logger?: Logger;
};

// A whole HTTP surface behind one Fetch entry point - what a Vercel route,
// a Worker or a Node server exports
export interface HostedFormApp {
  fetch: (request: Request) => Promise<Response>;
}

const MINT_PATH = '/webform/instance';
const RETURN_PATH = '/signing/return';
const HEALTH_PATH = '/health';

// The CORS response headers for this request: the allowed origin echoed
// back (or '*'), nothing at all for an origin the host did not allow
const corsHeaders = (
  cors: HostedFormAppCors | undefined,
  request: Request,
): Record<string, string> => {
  const origin = request.headers.get('origin');
  if (!cors || !origin) {
    return {};
  }
  if (cors.origins.includes('*')) {
    return { 'access-control-allow-origin': '*' };
  }
  return cors.origins.includes(origin)
    ? { 'access-control-allow-origin': origin, vary: 'origin' }
    : {};
};

const withHeaders = (response: Response, headers: Record<string, string>) => {
  for (const [key, value] of Object.entries(headers)) {
    response.headers.set(key, value);
  }
  return response;
};

// The mint endpoint's own surface: POST {path} to mint, the return-URL
// bridge the instance comes back to, a health check, and the CORS preflight
// when the host configured origins. Everything else is 404. The Express
// preset (createHostedFormRouter) mounts the same endpoints and shares this
// one's decisions: both go through mintWebFormInstanceHttp and the same
// prefill hook.
export const createHostedFormApp = (
  options: HostedFormAppOptions,
): HostedFormApp => {
  const path = options.path ?? MINT_PATH;
  const health = options.health ?? true;
  const mint = mintFor(options);

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
        const handler = createHostedFormInstanceHandler({
          mint: mintWithPrefillHook(mint, options.prefill, { request }),
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
