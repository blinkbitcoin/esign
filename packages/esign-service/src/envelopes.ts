// Envelope orchestration as Fetch handlers: the provider webhook and the
// GraphQL API.
//
// This module is the Node-only half of the service - it reaches the Knex
// store (and through it `pg`) and runs Apollo Server. createESignApp imports
// it dynamically, and only when DATABASE_URL turned the capability on, so a
// mint-only deployment never loads either, and the Cloudflare entry cannot
// reach them at all.

import { ApolloServer, HeaderMap, type HTTPGraphQLResponse } from '@apollo/server';
import { createWebhookHandler } from '@blinkbitcoin/esign-node';

import type { ESignProvider } from './providers/port';
import { resolvers, typeDefs } from './schema';
import { setActiveSpanAttributes } from './tracing';
import type { GraphQLContext } from './types';

// Apollo does not export the body union on its own
type HTTPGraphQLResponseBody = HTTPGraphQLResponse['body'];

// The two Fetch handlers the envelope capability adds, plus the shutdown the
// Node server drains through
export interface EnvelopeCapability {
  webhook: (request: Request) => Promise<Response>;
  graphql: (request: Request) => Promise<Response>;
  stop: () => Promise<void>;
}

export interface EnvelopeCapabilityOptions {
  provider: ESignProvider;
  // The session verification the mint uses, applied to the GraphQL context
  authenticate: (request: Request) => Promise<string | null>;
  // Apollo's schema discovery: on outside production, exactly as before
  introspection: boolean;
}

// The client IP as the platform reports it: whatever sits in front of the
// service put it in x-forwarded-for (the first entry is the client).
const clientIp = (request: Request): string | undefined =>
  request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || undefined;

// A Fetch Request as Apollo's transport-neutral HTTP request. Apollo parses
// the body itself for GET (persisted queries, the landing page) and expects
// the parsed JSON for POST.
const httpGraphQLRequestFrom = async (request: Request) => {
  const headers = new HeaderMap();
  request.headers.forEach((value, key) => headers.set(key, value));
  const url = new URL(request.url);
  const text = request.method === 'POST' ? await request.text() : '';
  let body: unknown;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      // Apollo answers 400 for a body it cannot use; handing it the raw text
      // keeps that decision (and its error shape) in one place
      body = text;
    }
  }
  return { method: request.method, headers, search: url.search, body };
};

// Apollo's answer as one string. This schema has no incremental delivery
// (@defer/@stream), so the complete body is what production ever sees; the
// chunked shape is part of Apollo's type and is concatenated rather than
// dropped.
export const graphQLResponseBody = async (body: HTTPGraphQLResponseBody): Promise<string> => {
  if (body.kind === 'complete') {
    return body.string;
  }
  let chunks = '';
  for await (const chunk of body.asyncIterator) {
    chunks += chunk;
  }
  return chunks;
};

export const createEnvelopeCapability = async (
  options: EnvelopeCapabilityOptions
): Promise<EnvelopeCapability> => {
  // Deferred to here so the module graph of a mint-only deployment never
  // reaches the Knex client
  const { envelopeService } = await import('./services.js');

  const apollo = new ApolloServer<GraphQLContext>({
    typeDefs,
    resolvers,
    // Schema discovery is disabled in production; stack traces are never
    // returned to clients (typed Errors.* with codes instead).
    introspection: options.introspection,
    includeStacktraceInErrorResponses: false,
  });
  await apollo.start();

  const webhook = createWebhookHandler({
    provider: options.provider,
    envelopes: envelopeService,
    clientIp,
  });

  return {
    webhook,
    graphql: async (request) => {
      const response = await apollo.executeHTTPGraphQLRequest({
        httpGraphQLRequest: await httpGraphQLRequestFrom(request),
        context: async () => {
          const userId = await options.authenticate(request);
          if (userId) {
            // Attach the caller to the request's trace (auto-instrumented span)
            setActiveSpanAttributes({ 'enduser.id': userId });
          }
          return { userId };
        },
      });

      const headers = new Headers();
      for (const [key, value] of response.headers) {
        headers.set(key, value);
      }
      return new Response(await graphQLResponseBody(response.body), {
        status: response.status ?? 200,
        headers,
      });
    },
    stop: () => apollo.stop(),
  };
};
