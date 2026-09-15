// @blinkbitcoin/esign-node/express - the HTTP surface as a mountable
// Express router: the mint endpoint (Web Forms, or an envelope), the
// provider webhook, the signing pages (the mock provider's, and DocuSign's
// return-URL bridge and mock Web Forms page via mountDocuSignPages) and a
// health check. The host owns authentication, CORS, rate limits and its
// GraphQL server (createESignGraphQL gives it the schema); this router owns
// the HTTP semantics of the esign endpoints.
//
// `express` is an optional peer: only this entry imports it.

import express, { type Request, type RequestHandler, Router } from 'express';
import type { EnvelopeService } from './envelopes';
import {
  asWebFormHook,
  ENVELOPE_MINT,
  type EnvelopeMintRequest,
  type EnvelopeMintTarget,
  type EnvelopePrefillParser,
  type EnvelopeTermsHook,
  type EnvelopeTermsInput,
  type HostedFormPrefillHook,
  type HostedFormPrefillInput,
  type HttpResult,
  type MintHook,
  type MintKind,
  type MintKindTarget,
  type MintTarget,
  mintInstanceHttp,
  mintOf,
  mintWebFormInstanceHttp,
  mintWithHook,
  type PrefillParser,
  processWebhookHttp,
  WEB_FORM_MINT,
  type WebFormMintRequest,
  webFormTarget,
} from './handlers';
import type { Logger } from './log';
import { renderMockSigningPage } from './pages';
import { type ESignProvider, hostedFormMint } from './provider';
import {
  type DocuSignPagesOptions,
  mountDocuSignPages,
} from './providers/docusign/express';
import type { WebFormPrefill } from './providers/docusign/types';
import { sendSigningPage } from './signingPageExpress';

export type { DocuSignPagesOptions } from './providers/docusign/express';
export { mountDocuSignPages } from './providers/docusign/express';

export interface ESignRouterMiddleware {
  // Applied to POST /webform/instance (e.g. CORS, rate limit); the OPTIONS
  // preflight gets `cors` only
  webform?: RequestHandler[];
  // Applied to POST /envelope/instance (createEnvelopeRouter), as `webform` is
  // to the Web Forms mint
  envelope?: RequestHandler[];
  cors?: RequestHandler;
  // Applied to POST /webhook/esign (e.g. rate limit)
  webhook?: RequestHandler[];
}

export interface ESignRouterOptions {
  envelopes: EnvelopeService;
  provider: ESignProvider;
  // The host's authentication: the caller's user id, or null when
  // unauthenticated (the mint endpoint answers 401)
  authenticate: (req: Request) => string | null | Promise<string | null>;
  // Serve the mock provider's pages; pass the mock's prefill lookup so the
  // mock web-form page shows minted values locked (undefined = pages off)
  mockPages?: {
    getWebFormPrefill: (instanceId: string) => WebFormPrefill | undefined;
  };
  middleware?: ESignRouterMiddleware;
  // JSON/text body cap - the signing/webhook bodies are small, so a tight
  // limit bounds naive payload-flood DoS (default 64kb)
  bodyLimit?: string;
  logger?: Logger;
}

// The JSON/text body cap: the signing/webhook bodies are small, so a tight
// limit bounds naive payload-flood DoS
const BODY_LIMIT = '64kb';

// The one health route every preset serves
const mountHealthRoute = (router: Router): void => {
  router.get('/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });
};

interface MintRouteOptions {
  // The host's policy on the mint endpoint: `cors` answers the preflight,
  // `chain` runs before the body is parsed
  cors?: RequestHandler;
  chain?: RequestHandler[];
  bodyLimit: string;
  // The decision (mintInstanceHttp over a kind) for this request
  handler: (req: Request) => Promise<HttpResult>;
}

// POST {path} (+ its CORS preflight): the host's middleware, the JSON body
// under the cap, then the decision as status + body. Every preset mounts its
// mint endpoint this way, so the HTTP semantics exist once.
const mountMintRoute = (
  router: Router,
  path: string,
  options: MintRouteOptions,
): void => {
  if (options.cors) {
    router.options(path, options.cors);
  }
  router.post(
    path,
    ...(options.chain ?? []),
    express.json({ limit: options.bodyLimit }),
    async (req, res) => {
      const result = await options.handler(req);
      res.status(result.status).json(result.body);
    },
  );
};

export const createESignRouter = (options: ESignRouterOptions): Router => {
  const { envelopes, provider, authenticate } = options;
  const logger = options.logger;
  const bodyLimit = options.bodyLimit ?? BODY_LIMIT;
  const middleware = options.middleware ?? {};
  const router = Router();

  mountHealthRoute(router);

  // DocuSign's pages: the return-URL bridge, and the mock Web Forms page
  // when the mock pages are on
  mountDocuSignPages(router, { mockPages: options.mockPages });

  if (options.mockPages) {
    // The mock provider's embedded signing page
    router.get('/signing/mock/:envelopeId', (req, res) => {
      sendSigningPage(res, nonce =>
        renderMockSigningPage(req.params.envelopeId, nonce),
      );
    });
  }

  // Mint a prefilled Web Forms instance for the authenticated caller. The
  // CORS preflight for a cross-origin host app is the host's cors handler.
  mountMintRoute(router, WEB_FORM_MINT.path, {
    cors: middleware.cors,
    chain: middleware.webform,
    bodyLimit,
    handler: async req =>
      mintWebFormInstanceHttp({
        userId: await authenticate(req),
        body: req.body,
        mint: hostedFormMint(provider),
        logger,
      }),
  });

  // Provider webhook. Signature verification and payload parsing belong to
  // the provider; the raw body (exact bytes) is what gets signed.
  router.post(
    '/webhook/esign',
    ...(middleware.webhook ?? []),
    express.text({ type: 'application/json', limit: bodyLimit }),
    async (req, res) => {
      const result = await processWebhookHttp({
        provider,
        envelopes,
        headers: req.headers,
        // The raw body (exact bytes) is what got signed
        rawBody: typeof req.body === 'string' ? req.body : '',
        ip: req.ip,
        logger,
      });
      res.status(result.status).json(result.body);
    },
  );

  return router;
};

// --- The mint router (the mint-only surface, for any kind) -------------------

export type MintRouterOptions<
  TInput extends object,
  TResult,
  TProvider,
  TParser,
> = MintKindTarget<TInput, TResult, TProvider> &
  MintRouterSurfaceOptions<TInput, TParser>;

// What the mint-only router takes besides its target; the named presets
// derive their options from this, so the shared fields exist once
export interface MintRouterSurfaceOptions<TInput extends object, TParser> {
  // The host's authentication: the caller's user id, or null when
  // unauthenticated (the mint endpoint answers 401)
  authenticate: (req: Request) => string | null | Promise<string | null>;
  // The host's hook between the validated request and the provider, told
  // the Express request behind the request
  hook?: MintHook<TInput, { req: Request }>;
  // Where the mint endpoint lives (default: the kind's path)
  path?: string;
  // Serve GET /health (default true)
  health?: boolean;
  // Serve the mock Web Forms page; pass the mock's prefill lookup so the
  // page shows minted values locked (undefined = page off)
  mockPages?: DocuSignPagesOptions['mockPages'];
  // The host's policy on the mint endpoint: `cors` answers the preflight,
  // `chain` runs before the body is parsed
  cors?: RequestHandler;
  chain?: RequestHandler[];
  // JSON body cap (default 64kb)
  bodyLimit?: string;
  // The prefill contract the request is held to (default: the kind's)
  parsePrefill?: TParser;
  logger?: Logger;
}

// The surface options as the named presets take them: the host's policy
// under `middleware`, keyed by the mint it applies to
type PresetRouterOptions<TInput extends object, TParser> = Omit<
  MintRouterSurfaceOptions<TInput, TParser>,
  'hook' | 'cors' | 'chain'
>;

// The mint-only HTTP surface, for any kind: everything a host needs to hand
// its app a signing URL and nothing else - POST {path}, the return-URL
// bridge the signer comes back to, and a health check. No envelope domain,
// no store, no webhook route: a host that wants those mounts
// createESignRouter instead. Same decisions as the Fetch preset
// (createMintApp), because both call mintInstanceHttp.
export const createMintRouter = <
  TInput extends object,
  TResult,
  TProvider,
  TParser,
>(
  kind: MintKind<TInput, TResult, TProvider, TParser>,
  options: MintRouterOptions<TInput, TResult, TProvider, TParser>,
): Router => {
  const router = Router();
  const mint = mintOf(kind, options);

  if (options.health ?? true) {
    mountHealthRoute(router);
  }

  // GET /signing/return (always) and the mock Web Forms page (with mockPages)
  mountDocuSignPages(router, { mockPages: options.mockPages });

  mountMintRoute(router, options.path ?? kind.path, {
    cors: options.cors,
    chain: options.chain,
    bodyLimit: options.bodyLimit ?? BODY_LIMIT,
    handler: async req =>
      mintInstanceHttp(kind, {
        userId: await options.authenticate(req),
        body: req.body,
        mint: mintWithHook(mint, options.hook, { req }),
        parsePrefill: options.parsePrefill,
        logger: options.logger,
      }),
  });

  return router;
};

// What the mint-only preset's prefill hook is told: the caller, the prefill
// that caller sent (validated), and the Express request behind it
export interface HostedFormRouterPrefillInput extends HostedFormPrefillInput {
  req: Request;
}

export type HostedFormRouterOptions = MintTarget &
  PresetRouterOptions<WebFormMintRequest, PrefillParser> & {
    // The host's chance to compute the terms it locks from its own data: it
    // receives the caller's validated prefill and returns the prefill that is
    // actually minted. Client values are input, never trusted for read-only
    // fields.
    prefill?: HostedFormPrefillHook<HostedFormRouterPrefillInput>;
    middleware?: Pick<ESignRouterMiddleware, 'cors' | 'webform'>;
  };

// The Web Forms mint as a mint-only router: createMintRouter over its kind,
// with the public target and hook shapes (the prefill itself) adapted by the
// kind's own helpers
export const createHostedFormRouter = (
  options: HostedFormRouterOptions,
): Router =>
  createMintRouter(WEB_FORM_MINT, {
    ...options,
    ...webFormTarget(options),
    hook: asWebFormHook<{ req: Request }>(options.prefill),
    cors: options.middleware?.cors,
    chain: options.middleware?.webform,
  });

// What the envelope preset's terms hook is told: the caller, the signer and
// prefill that caller sent (validated), and the Express request behind them
export interface EnvelopeRouterTermsInput extends EnvelopeTermsInput {
  req: Request;
}

export type EnvelopeRouterOptions = EnvelopeMintTarget &
  PresetRouterOptions<EnvelopeMintRequest, EnvelopePrefillParser> & {
    // The host's chance to decide who signs and what the envelope locks, from
    // its own data: it receives the caller's validated request and returns
    // the one the envelope is created with. Client values are input, never
    // trusted for the signer or for a locked value.
    terms?: EnvelopeTermsHook<EnvelopeRouterTermsInput>;
    middleware?: Pick<ESignRouterMiddleware, 'cors' | 'envelope'>;
  };

// The envelope mint as a mint-only router: createMintRouter over its kind
export const createEnvelopeRouter = (options: EnvelopeRouterOptions): Router =>
  createMintRouter(ENVELOPE_MINT, {
    ...options,
    hook: options.terms,
    cors: options.middleware?.cors,
    chain: options.middleware?.envelope,
  });
