// Express app factory for testability
// Separates app creation from server startup

import { ApolloServer } from '@apollo/server';
import { expressMiddleware } from '@as-integrations/express5';
import cors from 'cors';
import crypto from 'crypto';
import express from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import { getUserIdFromAuthHeader } from './auth';
import { getAllowedOrigins } from './config';
import { provider } from './providers';
import { supportsWebForms } from './providers/port';
import { resolvers, typeDefs } from './schema';
import {
  renderMockSigningPage,
  renderMockWebFormPage,
  renderSigningReturnBridge,
} from './signingPages';
import { setActiveSpanAttributes } from './tracing';
import type { GraphQLContext, WebFormPrefill } from './types';
import { handleWebhookEvent } from './webhook';

// Body size cap for JSON/text payloads - the signing/webhook bodies are small,
// so a tight limit bounds naive payload-flood DoS.
const BODY_LIMIT = '64kb';

const isProduction = (): boolean => process.env.NODE_ENV === 'production';

// CORS: reflect only explicitly allow-listed origins (CORS_ALLOWED_ORIGINS).
// With none configured, no cross-origin is allowed (same-origin API).
const corsOptions = (): cors.CorsOptions => {
  const allowed = getAllowedOrigins();
  return {
    origin: allowed.length > 0 ? allowed : false,
  };
};

// Rate limiter factory (standard headers, no legacy headers)
const makeRateLimiter = (windowMs: number, max: number) =>
  rateLimit({ windowMs, limit: max, standardHeaders: 'draft-7', legacyHeaders: false });

// Create and configure Express app
// Returns app for testing or server startup
export const createApp = async (): Promise<express.Express> => {
  const app = express();

  // Behind a proxy/load balancer in production - trust it so req.ip and
  // rate-limit keys reflect the real client, not the proxy.
  if (isProduction()) {
    app.set('trust proxy', 1);
  }

  // Baseline security headers. CSP is set per-route: the JSON API needs none,
  // the HTML signing pages need a tailored (nonce-based) policy.
  app.use(helmet({ contentSecurityPolicy: false }));

  // Create Apollo Server instance
  const server = new ApolloServer<GraphQLContext>({
    typeDefs,
    resolvers,
    // Schema discovery is disabled in production; stack traces are never
    // returned to clients (rely on typed Errors.* with codes instead).
    introspection: !isProduction(),
    includeStacktraceInErrorResponses: false,
  });

  // Start Apollo Server
  await server.start();

  // Health check endpoint (non-GraphQL)
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  // The two signing pages are HTML meant to be embedded (WebView/iframe) and
  // run a small inline script. A per-response nonce lets us keep a strict CSP
  // (no 'unsafe-inline') while still allowing that one script. frame-ancestors
  // is left open because these pages carry no secrets (the event payload is a
  // fixed enum) and must be embeddable by any host integrating the SDK.
  const signingPageCsp = (nonce: string): string =>
    [
      "default-src 'none'",
      `script-src 'nonce-${nonce}'`,
      "style-src 'nonce-" + nonce + "'",
      'frame-ancestors *',
    ].join('; ');

  const sendSigningPage = (res: express.Response, html: string, nonce: string): void => {
    res.setHeader('Content-Security-Policy', signingPageCsp(nonce));
    res.type('html').send(html);
  };

  // Mock provider's embedded signing page - lets the full WebView/iframe
  // signing flow run without DocuSign credentials (manual testing + Maestro)
  app.get('/signing/mock/:envelopeId', (req, res) => {
    const nonce = crypto.randomBytes(16).toString('base64');
    sendSigningPage(res, renderMockSigningPage(req.params.envelopeId, nonce), nonce);
  });

  // Return-URL bridge for REAL DocuSign embedded signing: DocuSign redirects
  // here with ?event=... (it never postMessages); this page forwards the
  // event to the host app in the postMessage protocol the components expect.
  // DOCUSIGN_RETURN_URL defaults to this route.
  app.get('/signing/return', (req, res) => {
    const nonce = crypto.randomBytes(16).toString('base64');
    const rawEvent = typeof req.query.event === 'string' ? req.query.event : undefined;
    sendSigningPage(res, renderSigningReturnBridge(rawEvent, nonce), nonce);
  });

  // Mock DocuSign Web Forms instance page (emits the real DocuSign event
  // vocabulary). Served by the mock provider's instance URL.
  app.get('/signing/mock-webform/:instanceId', (req, res) => {
    const nonce = crypto.randomBytes(16).toString('base64');
    sendSigningPage(res, renderMockWebFormPage(req.params.instanceId, nonce), nonce);
  });

  // Create a prefilled Web Forms signing instance and return its embeddable
  // URL. The host's createWebFormsSource calls this. Mints via the configured
  // provider (mock → mock-webform page; docusign → real Instances:createInstance).
  // CORS preflight for the cross-origin fetch from a host web app
  app.options('/webform/instance', cors<cors.CorsRequest>(corsOptions()));
  app.post(
    '/webform/instance',
    makeRateLimiter(60_000, 60),
    cors<cors.CorsRequest>(corsOptions()),
    express.json({ limit: BODY_LIMIT }),
    async (req, res) => {
      const userId = getUserIdFromAuthHeader(req.headers.authorization);
      if (!userId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }
      if (!supportsWebForms(provider)) {
        res.status(400).json({ error: 'Web Forms not supported by the configured provider' });
        return;
      }
      // req.body is undefined for a bodyless request, an object otherwise
      const prefill: WebFormPrefill =
        (req.body as { prefill?: WebFormPrefill } | undefined)?.prefill ?? {};
      try {
        const instance = await provider.createWebFormInstance(userId, prefill);
        res.status(200).json(instance);
      } catch (error) {
        const code =
          error && typeof error === 'object' && 'extensions' in error
            ? (error as { extensions?: { code?: string } }).extensions?.code
            : undefined;
        console.error('Web Forms instance creation failed:', code ?? 'UNKNOWN_ERROR');
        res.status(502).json({ error: 'Could not create signing session' });
      }
    }
  );

  // E-signature provider webhook endpoint (provider-agnostic).
  // Signature verification and payload parsing are delegated to the
  // configured provider; this route only owns the HTTP semantics.
  // Signature validation happens before any database operations
  // CRITICAL: Use express.text() to get raw body for signature validation -
  // providers compute signatures over exact bytes sent; re-serializing would
  // change the signature
  app.post(
    '/webhook/esign',
    makeRateLimiter(60_000, 120),
    express.text({ type: 'application/json', limit: BODY_LIMIT }),
    async (req, res) => {
      // Get raw body string (before JSON parsing) for signature validation
      const rawBody = typeof req.body === 'string' ? req.body : '';

      // Signature validation BEFORE any processing
      // Return 401 Unauthorized for invalid/missing signatures
      if (!provider.verifyWebhook(req.headers, rawBody, req.ip)) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      // Parse and validate payload after signature validation passes
      const event = provider.parseWebhookEvent(rawBody);
      if (!event) {
        console.error('Webhook error: Invalid payload');
        res.status(400).json({ error: 'Invalid payload' });
        return;
      }

      // Valid signature - process webhook normally
      try {
        await handleWebhookEvent(event);
        res.status(200).json({ received: true });
      } catch (error) {
        // Transient processing failure (e.g. database outage): return 500 so
        // the provider retries later. handleWebhookEvent is idempotent, so a
        // retry after recovery converges to the correct status - returning 200
        // here would permanently lose the update. Permanent conditions (unknown
        // envelope or status) are handled inside the handler and return 200.
        console.error('Webhook processing error:', error instanceof Error ? error.message : error);
        res.status(500).json({ error: 'Processing failed' });
      }
    }
  );

  // GraphQL endpoint with middleware
  app.use(
    '/graphql',
    makeRateLimiter(60_000, 100),
    cors<cors.CorsRequest>(corsOptions()),
    express.json({ limit: BODY_LIMIT }),
    expressMiddleware(server, {
      context: async ({ req }) => {
        // Verified JWT `sub` when JWT_SECRET is configured; dev passthrough
        // (token = userId) otherwise. See src/auth.ts.
        const userId = getUserIdFromAuthHeader(req.headers.authorization);
        if (userId) {
          // Attach the caller to the request's trace (auto-instrumented span)
          setActiveSpanAttributes({ 'enduser.id': userId });
        }
        return { userId };
      },
    })
  );

  return app;
};
