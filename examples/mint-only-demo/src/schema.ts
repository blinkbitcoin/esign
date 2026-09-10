// The host's own GraphQL API with the one mutation added. Everything else
// here (types, auth in the context) stands in for what the host already has.

import type { HostedFormMint } from '@blinkbitcoin/esign-node';
import { prefillFromQuote, quoteFor } from './quote';

export interface Context {
  // The caller, resolved by the host's own session handling (see server.ts)
  userId: string | null;
  mint: HostedFormMint;
}

export const typeDefs = `#graphql
  type SigningUrl {
    "Open this in the ESignature component (createWebFormsSource)"
    url: String!
    instanceId: String
  }

  type Query {
    health: String!
  }

  type Mutation {
    """
    Mint a Web Forms instance for a subscription of \`units\`. The amounts are
    computed here and arrive locked in the form; the signer only adds what the
    form leaves editable.
    """
    investSigningUrl(units: Int!): SigningUrl!
  }
`;

export const resolvers = {
  Query: { health: () => 'ok' },
  Mutation: {
    investSigningUrl: async (
      _parent: unknown,
      args: { units: number },
      context: Context,
    ) => {
      if (!context.userId) {
        throw new Error('Unauthenticated');
      }
      const prefill = prefillFromQuote(quoteFor(args.units));
      return context.mint(context.userId, prefill);
    },
  },
};
