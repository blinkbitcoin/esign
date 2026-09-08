// Apollo Server over the schema, with the host's session handling in the
// context. This example accepts `Authorization: Bearer <userId>` as-is -
// a real host verifies its own session token here (the full-service demo
// shows an HS256 JWT check); the package never sees the token.

import { ApolloServer } from '@apollo/server';
import { startStandaloneServer } from '@apollo/server/standalone';
import type { Mint } from './mint';
import { type Context, resolvers, typeDefs } from './schema';

export const userFromAuthorization = (
  header: string | undefined,
): string | null => {
  if (!header?.startsWith('Bearer ')) {
    return null;
  }
  // HTTP parsers strip the whitespace around header values, so a token is
  // never empty once the prefix matched
  return header.slice('Bearer '.length).trim();
};

export const createServer = (mint: Mint) => {
  const server = new ApolloServer<Context>({ typeDefs, resolvers });
  const context = async ({
    req,
  }: {
    req: { headers: { authorization?: string } };
  }): Promise<Context> => ({
    userId: userFromAuthorization(req.headers.authorization),
    mint,
  });
  return {
    server,
    // Listen on a port (0 = any free port); resolves the URL
    start: (port: number) =>
      startStandaloneServer(server, { context, listen: { port } }),
  };
};
