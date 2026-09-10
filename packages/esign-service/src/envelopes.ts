// Envelope orchestration as Fetch handlers: the provider webhook and the
// GraphQL API.
//
// This module is the Node-only half of the service - it reaches the Knex
// store (and through it `pg`) and runs Apollo Server. Nothing imports it
// statically: `createESignApp` receives a `loadEnvelopes` loader from the
// entry that can supply one (./node, ./vercel), and the Cloudflare entry
// supplies none, so no bundler can reach `pg` or `@apollo/server` from a
// Worker's entry point at all.

import { ApolloServer, HeaderMap, type HTTPGraphQLResponse } from '@apollo/server';
import { createWebhookHandler, type EnvelopeStore } from '@blinkbitcoin/esign-node';

import type { Env } from './env';
import type { ESignProvider } from './providers/port';
import { forwardedClientIp } from './proxy';
import { createGraphQL } from './schema';
import { createServices } from './services';
import { createStore } from './store';
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
  // The environment the app was constructed with - the store connects to
  // THIS env's DATABASE_URL, not to whatever process.env happens to hold
  env: Env;
  // The adapter the app resolved: the resolvers and the webhook run on the
  // same one the mint does
  provider: ESignProvider;
  // The session verification the mint uses, applied to the GraphQL context
  authenticate: (request: Request) => Promise<string | null>;
  // Apollo's schema discovery: on outside production, exactly as before
  introspection: boolean;
  // Believe x-forwarded-for when logging the webhook's caller (the same
  // TRUST_PROXY the rate limits key on)
  trustProxy: boolean;
  // The store to run on (default: a Knex store over `env`'s DATABASE_URL).
  // Tests hand in an in-memory one; nothing else overrides it.
  store?: EnvelopeStore;
}

// What `createESignApp` is handed to reach this module without naming it
export interface EnvelopeModule {
  createEnvelopeCapability: (options: EnvelopeCapabilityOptions) => Promise<EnvelopeCapability>;
}

export type LoadEnvelopes = () => Promise<EnvelopeModule>;

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
  const envelopes = createServices(options.provider, options.store ?? createStore(options.env));
  const { typeDefs, resolvers } = createGraphQL(envelopes);

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
    envelopes,
    clientIp: (request) => forwardedClientIp(request, options.trustProxy),
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
