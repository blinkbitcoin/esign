// Framework-neutral HTTP handlers for the two esign endpoints, as Fetch API
// Request → Response functions: mountable as a serverless / route handler
// (Vercel, Netlify, Next.js route handlers, Lambda via an adapter) with no
// Express. The decision logic (status codes, bodies) lives in the two
// `*Http` functions and is shared with the Express router.

import type { EnvelopeService } from './envelopes';
import { getErrorCode } from './errors';
import { consoleLogger, type Logger } from './log';
import { parseWebFormPrefill } from './prefill';
import type { ESignProvider } from './provider';
import type {
  WebFormInstanceResult,
  WebFormPrefill,
  WebhookHeaders,
} from './types';
import {
  createWebFormInstance,
  type CreateWebFormInstanceParams,
} from './webforms';

// An HTTP outcome, independent of the framework that sends it
export interface HttpResult {
  status: number;
  body: unknown;
}

// --- Mint --------------------------------------------------------------------

export interface MintHttpInput {
  // The authenticated caller, or null (→ 401)
  userId: string | null;
  // The parsed JSON body, if any ({ prefill })
  body: unknown;
  // How to mint for a user (a provider's createWebFormInstance, or the
  // package's createWebFormInstance bound to a config)
  mint:
    | ((
        userId: string,
        prefill: WebFormPrefill,
      ) => Promise<WebFormInstanceResult>)
    | undefined;
  logger?: Logger;
}

// POST /webform/instance semantics: 401 unauthenticated, 400 when Web Forms
// are unsupported or the prefill is outside the contract (with the reason,
// before any provider call), 502 when minting fails, else 200 + the instance
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
  const parsed = parseWebFormPrefill(
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

export type MintTarget =
  // Mint with a provider (the service's way)
  | { provider: ESignProvider }
  // Mint straight from a DocuSign config/client (the serverless way)
  | Pick<
      CreateWebFormInstanceParams,
      'config' | 'client' | 'returnUrl' | 'expirationOffsetHours'
    >;

export type WebFormInstanceHandlerOptions = MintTarget & {
  // The host's authentication: the caller's user id, or null (→ 401)
  authenticate: (request: Request) => string | null | Promise<string | null>;
  logger?: Logger;
};

// The mint call for either target
const mintFor = (target: MintTarget): MintHttpInput['mint'] => {
  if ('provider' in target) {
    const { provider } = target;
    return provider.createWebFormInstance
      ? (userId, prefill) => provider.createWebFormInstance!(userId, prefill)
      : undefined;
  }
  return (userId, prefill) =>
    createWebFormInstance({ ...target, userId, prefill });
};

// POST /webform/instance as a Fetch API handler
export const createWebFormInstanceHandler = (
  options: WebFormInstanceHandlerOptions,
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
        logger: options.logger,
      }),
    );
  };
};

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
