// @blinkbitcoin/esign-server/express - the HTTP surface as a mountable
// Express router: the Web Forms mint endpoint, the provider webhook, the
// signing pages (mock pages + the real-DocuSign return-URL bridge) and a
// health check. The host owns authentication, CORS, rate limits and its
// GraphQL server (createESignGraphQL gives it the schema); this router owns
// the HTTP semantics of the esign endpoints.
//
// `express` is an optional peer: only this entry imports it.

import express, {
  type Request,
  type RequestHandler,
  type Response,
  Router,
} from 'express';
import type { EnvelopeService } from './envelopes';
import { mintWebFormInstanceHttp, processWebhookHttp } from './handlers';
import type { Logger } from './log';
import {
  mockWebFormFields,
  renderMockSigningPage,
  renderMockWebFormPage,
  renderSigningReturnBridge,
} from './pages';
import type { ESignProvider } from './provider';
import { signingPageCsp, signingPageNonce } from './signingPage';
import type { WebFormPrefill } from './types';

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

// The signing pages share one CSP + nonce recipe with the Fetch-native
// signingPageResponse (signingPage.ts); this is its Express spelling
const sendSigningPage = (
  res: Response,
  render: (nonce: string) => string,
): void => {
  const nonce = signingPageNonce();
  res.setHeader('Content-Security-Policy', signingPageCsp(nonce));
  res.type('html').send(render(nonce));
};

export const createESignRouter = (options: ESignRouterOptions): Router => {
  const { envelopes, provider, authenticate } = options;
  const logger = options.logger;
  const bodyLimit = options.bodyLimit ?? '64kb';
  const middleware = options.middleware ?? {};
  const router = Router();

  router.get('/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  // Return-URL bridge for REAL DocuSign: DocuSign redirects here with
  // ?event=... (it never postMessages); the page forwards the event to the
  // host app in the postMessage protocol the components expect.
  router.get('/signing/return', (req, res) => {
    const rawEvent =
      typeof req.query.event === 'string' ? req.query.event : undefined;
    sendSigningPage(res, nonce => renderSigningReturnBridge(rawEvent, nonce));
  });

  if (options.mockPages) {
    const { getWebFormPrefill } = options.mockPages;

    // The mock provider's embedded signing page
    router.get('/signing/mock/:envelopeId', (req, res) => {
      sendSigningPage(res, nonce =>
        renderMockSigningPage(req.params.envelopeId, nonce),
      );
    });

    // The mock Web Forms instance page: minted prefill locked, query-string
    // prefill (public-form style) editable
    router.get('/signing/mock-webform/:instanceId', (req, res) => {
      const fields = mockWebFormFields(
        getWebFormPrefill(req.params.instanceId),
        req.query,
      );
      sendSigningPage(res, nonce =>
        renderMockWebFormPage(req.params.instanceId, nonce, fields),
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
        mint: provider.createWebFormInstance
          ? (userId, prefill) =>
              provider.createWebFormInstance!(userId, prefill)
          : undefined,
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
