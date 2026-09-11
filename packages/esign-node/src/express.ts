// @blinkbitcoin/esign-node/express - the HTTP surface as a mountable
// Express router: the Web Forms mint endpoint, the provider webhook, the
// signing pages (the mock provider's, and DocuSign's return-URL bridge and
// mock Web Forms page via mountDocuSignPages) and a health check. The host
// owns authentication, CORS, rate limits and its GraphQL server
// (createESignGraphQL gives it the schema); this router owns the HTTP
// semantics of the esign endpoints.
//
// `express` is an optional peer: only this entry imports it.

import express, { type Request, type RequestHandler, Router } from 'express';
import type { EnvelopeService } from './envelopes';
import {
  type HostedFormPrefillHook,
  type HostedFormPrefillInput,
  type HttpResult,
  type MintTarget,
  mintWebFormInstanceHttp,
  mintWithPrefillHook,
  type PrefillParser,
  processWebhookHttp,
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

// Where a hosted-form instance is minted unless the host says otherwise
const MINT_PATH = '/webform/instance';

// The JSON/text body cap: the signing/webhook bodies are small, so a tight
// limit bounds naive payload-flood DoS
const BODY_LIMIT = '64kb';

// The one health route both presets serve
const mountHealthRoute = (router: Router): void => {
  router.get('/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });
};

interface MintRouteOptions {
  // The host's policy on the mint endpoint: `cors` answers the preflight,
  // `webform` runs before the body is parsed
  middleware?: Pick<ESignRouterMiddleware, 'cors' | 'webform'>;
  bodyLimit: string;
  // The decision (mintWebFormInstanceHttp) for this request
  handler: (req: Request) => Promise<HttpResult>;
}

// POST {path} (+ its CORS preflight): the host's middleware, the JSON body
// under the cap, then the decision as status + body. Both presets mount
// their mint endpoint this way, so the HTTP semantics exist once.
const mountMintRoute = (
  router: Router,
  path: string,
  options: MintRouteOptions,
): void => {
  const middleware = options.middleware ?? {};
  if (middleware.cors) {
    router.options(path, middleware.cors);
  }
  router.post(
    path,
    ...(middleware.webform ?? []),
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
  mountMintRoute(router, MINT_PATH, {
    middleware,
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

// What the mint-only preset's prefill hook is told: the caller, the prefill
// that caller sent (validated), and the Express request behind it
export interface HostedFormRouterPrefillInput extends HostedFormPrefillInput {
  req: Request;
}

export type HostedFormRouterOptions = MintTarget & {
  // The host's authentication: the caller's user id, or null when
  // unauthenticated (the mint endpoint answers 401)
  authenticate: (req: Request) => string | null | Promise<string | null>;
  // The host's chance to compute the terms it locks from its own data: it
  // receives the caller's validated prefill and returns the prefill that is
  // actually minted. Client values are input, never trusted for read-only
  // fields.
  prefill?: HostedFormPrefillHook<HostedFormRouterPrefillInput>;
  // Where the mint endpoint lives (default /webform/instance)
  path?: string;
  // Serve GET /health (default true)
  health?: boolean;
  // Serve the mock Web Forms page; pass the mock's prefill lookup so the
  // page shows minted values locked (undefined = page off)
  mockPages?: DocuSignPagesOptions['mockPages'];
  middleware?: Pick<ESignRouterMiddleware, 'cors' | 'webform'>;
  // JSON body cap (default 64kb)
  bodyLimit?: string;
  // The provider's prefill validation (default: DocuSign's)
  parsePrefill?: PrefillParser;
  logger?: Logger;
};

// The mint-only HTTP surface: everything a host needs to hand its app a
// locked hosted-form instance and nothing else - POST {path}, the
// return-URL bridge the instance comes back to, and a health check. No
// envelope domain, no store, no webhook route: a host that wants those
// mounts createESignRouter instead. Same decisions as the Fetch preset
// (createHostedFormApp), because both call mintWebFormInstanceHttp.
export const createHostedFormRouter = (
  options: HostedFormRouterOptions,
): Router => {
  const router = Router();
  const mint =
    'provider' in options ? hostedFormMint(options.provider) : options.mint;

  if (options.health ?? true) {
    mountHealthRoute(router);
  }

  // GET /signing/return (always) and the mock Web Forms page (with mockPages)
  mountDocuSignPages(router, { mockPages: options.mockPages });

  mountMintRoute(router, options.path ?? MINT_PATH, {
    middleware: options.middleware,
    bodyLimit: options.bodyLimit ?? BODY_LIMIT,
    handler: async req =>
      mintWebFormInstanceHttp({
        userId: await options.authenticate(req),
        body: req.body,
        mint: mintWithPrefillHook(mint, options.prefill, { req }),
        parsePrefill: options.parsePrefill,
        logger: options.logger,
      }),
  });

  return router;
};
