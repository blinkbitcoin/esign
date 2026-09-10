// Express app factory for testability: this service's policy (security
// headers, CORS allow-list, rate limits, JWT auth) around the package's
// GraphQL schema and Express router.

import { ApolloServer } from '@apollo/server';
import { expressMiddleware } from '@as-integrations/express5';
import { createESignRouter } from '@blinkbitcoin/esign-node/express';
import cors from 'cors';
import express from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import { getUserIdFromAuthHeader } from './auth';
import { getAllowedOrigins } from './config';
import { provider } from './providers';
import { getWebFormPrefill } from './providers/mock';
import { resolvers, typeDefs } from './schema';
import { envelopeService } from './services';
import { setActiveSpanAttributes } from './tracing';
import type { GraphQLContext } from './types';

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

  // Baseline security headers. The default CSP is fail-closed (nothing may
  // load, nothing may frame us): correct for the JSON API and for any route
  // that forgets to set its own. The HTML signing pages (the package's
  // router) replace it per response with their nonce-based policy.
  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: false,
        directives: { 'default-src': ["'none'"], 'frame-ancestors': ["'none'"] },
      },
    })
  );

  const server = new ApolloServer<GraphQLContext>({
    typeDefs,
    resolvers,
    // Schema discovery is disabled in production; stack traces are never
    // returned to clients (rely on typed Errors.* with codes instead).
    introspection: !isProduction(),
    includeStacktraceInErrorResponses: false,
  });
  await server.start();

  // The esign endpoints: /health, the signing pages (mock pages are served
  // by this service for the mock provider), POST /webform/instance and
  // POST /webhook/esign - with this service's auth, CORS and rate limits.
  const corsMiddleware = cors<cors.CorsRequest>(corsOptions());
  app.use(
    createESignRouter({
      envelopes: envelopeService,
      provider,
      authenticate: (req) => getUserIdFromAuthHeader(req.headers.authorization),
      mockPages: { getWebFormPrefill },
      middleware: {
        cors: corsMiddleware,
        webform: [makeRateLimiter(60_000, 60), corsMiddleware],
        webhook: [makeRateLimiter(60_000, 120)],
      },
      bodyLimit: BODY_LIMIT,
    })
  );

  // Outside production, GET /graphql serves Apollo's landing page (embedded
  // sandbox loaded from Apollo's CDN), which the fail-closed default CSP would
  // block. Lift it for that one dev-only HTML response; production never
  // serves a landing page and keeps the strict header.
  if (!isProduction()) {
    app.get('/graphql', (_req, res, next) => {
      res.removeHeader('Content-Security-Policy');
      next();
    });
  }

  // GraphQL endpoint with middleware
  app.use(
    '/graphql',
    makeRateLimiter(60_000, 100),
    corsMiddleware,
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
