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
import { mintWebFormInstanceHttp, processWebhookHttp } from './handlers';
import type { Logger } from './log';
import { renderMockSigningPage } from './pages';
import { type ESignProvider, hostedFormMint } from './provider';
import { mountDocuSignPages } from './providers/docusign/express';
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

export const createESignRouter = (options: ESignRouterOptions): Router => {
  const { envelopes, provider, authenticate } = options;
  const logger = options.logger;
  const bodyLimit = options.bodyLimit ?? '64kb';
  const middleware = options.middleware ?? {};
  const router = Router();

  router.get('/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

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
  if (middleware.cors) {
    router.options('/webform/instance', middleware.cors);
  }
  router.post(
    '/webform/instance',
    ...(middleware.webform ?? []),
    express.json({ limit: bodyLimit }),
    async (req, res) => {
      const result = await mintWebFormInstanceHttp({
        userId: await authenticate(req),
        body: req.body,
        mint: hostedFormMint(provider),
        logger,
      });
      res.status(result.status).json(result.body);
    },
  );

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
