// Apollo Server over the schema on Express, with the host's session handling
// in the context, plus the one extra route a Web Forms host needs: the
// return-URL bridge. This example accepts `Authorization: Bearer <userId>`
// as-is - a real host verifies its own session token here (the full-service
// demo shows an HS256 JWT check); the package never sees the token.

import { createServer as createHttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { ApolloServer } from '@apollo/server';
import { expressMiddleware } from '@as-integrations/express5';
import {
  bearerToken,
  renderSigningReturnBridge,
  signingPageCsp,
  signingPageNonce,
} from '@blinkbitcoin/esign-server';
import express from 'express';
import type { Mint } from './mint';
import { type Context, resolvers, typeDefs } from './schema';

export const userFromAuthorization = (
  header: string | undefined,
): string | null => bearerToken(header);

export const createServer = (mint: Mint) => {
  const apollo = new ApolloServer<Context>({ typeDefs, resolvers });
  const app = express();

  // The return-URL bridge: DocuSign sends the signer here after the form's
  // envelope is signed (DOCUSIGN_RETURN_URL, passed as the instance's
  // returnUrl), and the page posts the outcome to the app's WebView/iframe in
  // the protocol the ESignature components expect. Without it a Web Form
  // completes on DocuSign's side but the app never hears about it.
  app.get('/signing/return', (req, res) => {
    const rawEvent =
      typeof req.query.event === 'string' ? req.query.event : undefined;
    // The package's CSP (nonce-only inline script/style, framed by any host:
    // the page runs inside the app's WebView/iframe)
    const nonce = signingPageNonce();
    res.setHeader('Content-Security-Policy', signingPageCsp(nonce));
    res.type('html').send(renderSigningReturnBridge(rawEvent, nonce));
  });

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
