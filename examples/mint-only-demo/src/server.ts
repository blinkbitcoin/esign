// Apollo Server over the schema on Express, with the host's session handling
// in the context, plus the package's hosted-form router (@blinkbitcoin/esign-node/express)
// mounted alongside it - the REST spelling of the same mint, so both are
// shown side by side (a real host picks one). This example accepts
// `Authorization: Bearer <userId>` as-is - a real host verifies its own
// session token here (the full-service demo shows an HS256 JWT check); the
// package never sees the token.

import { createServer as createHttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { ApolloServer } from '@apollo/server';
import { expressMiddleware } from '@as-integrations/express5';
import {
  bearerToken,
  Errors,
  type HostedFormMint,
  type Logger,
} from '@blinkbitcoin/esign-node';
import { createHostedFormRouter } from '@blinkbitcoin/esign-node/express';
import express from 'express';
import { prefillFromQuote, quoteFor, unitsFrom } from './quote';
import { type Context, resolvers, typeDefs } from './schema';

export const userFromAuthorization = (
  header: string | undefined,
): string | null => bearerToken(header);

// What a host injects: where the package reports (default: the console)
export interface ServerOptions {
  logger?: Logger;
}

export const createServer = (
  mint: HostedFormMint,
  options: ServerOptions = {},
) => {
  const apollo = new ApolloServer<Context>({ typeDefs, resolvers });
  const app = express();

  // The REST spelling: POST /webform/instance, the return-URL bridge
  // (GET /signing/return, DOCUSIGN_RETURN_URL points at it - DocuSign sends
  // the signer here after the form's envelope is signed, and the page posts
  // the outcome to the app's WebView/iframe) and GET /health. The prefill
  // hook computes the same locked amounts the GraphQL mutation does, from
  // the client's own `number_of_units` (intent, never trusted directly -
  // quoteFor(unitsFrom(prefill)) is the one place that validates it).
  app.use(
    createHostedFormRouter({
      mint,
      logger: options.logger,
      authenticate: req => userFromAuthorization(req.headers.authorization),
      prefill: ({ prefill }) => {
        try {
          return prefillFromQuote(quoteFor(unitsFrom(prefill)));
        } catch (error) {
          // quoteFor's RangeError (an invalid, out-of-range or missing
          // number_of_units) is this demo's own validation shape;
          // mintWebFormInstanceHttp (the router's HTTP layer) only
          // recognizes Errors.validationError as a 400 - translate here,
          // or a bad request would read as the generic 502 a real
          // provider/network failure gets instead.
          throw Errors.validationError((error as Error).message);
        }
      },
    }),
  );

  const httpServer = createHttpServer(app);
  return {
    server: {
      stop: async () => {
        await apollo.stop();
        await new Promise<void>(resolve => {
          httpServer.close(() => resolve());
        });
      },
    },
    // Listen on a port (0 = any free port); resolves the GraphQL URL
    start: async (port: number): Promise<{ url: string }> => {
      await apollo.start();
      app.use(
        '/',
        express.json(),
        expressMiddleware(apollo, {
          context: async ({ req }): Promise<Context> => ({
            userId: userFromAuthorization(req.headers.authorization),
            mint,
          }),
        }),
      );
      await new Promise<void>(resolve => {
        httpServer.listen(port, resolve);
      });
      // A listening TCP server always reports an AddressInfo
      const { port: bound } = httpServer.address() as AddressInfo;
      return { url: `http://localhost:${bound}/` };
    },
  };
};
