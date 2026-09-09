// The GraphQL wire layer: the SDL (the contract the client packages codegen
// against) and the resolvers over an envelope service. No Apollo dependency
// - a host hands `typeDefs` + `resolvers` to its own GraphQL server, with a
// context carrying the authenticated user id.

import type { EnvelopeService } from './envelopes';
import type { CreateEnvelopeInput, GetSigningUrlInput } from './types';

// Context type for the resolvers: the authenticated user, or null
export interface GraphQLContext {
  userId: string | null;
}

// GraphQL SDL - kept free of runtime imports so tooling (schema emission,
// drift tests, client codegen) can load it without a database connection.
export const typeDefs = `#graphql
  type Query {
    health: HealthCheck!
    envelope(id: String!): Envelope
    auditLogs(envelopeId: String!): [AuditLog!]!
  }

  type Mutation {
    createEnvelope(input: CreateEnvelopeInput!): EnvelopeResult!
    getSigningUrl(input: GetSigningUrlInput!): SigningUrlResult!
  }

  type HealthCheck {
    status: String!
    timestamp: String!
  }

  # Envelope type for status queries
  # SECURITY: providerEnvelopeId is intentionally NOT included - never expose provider IDs
  type Envelope {
    id: String!
    status: String!
    contractType: String!
    createdAt: String!
  }

  input RecipientInput {
    name: String!
    email: String!
  }

  input CreateEnvelopeInput {
    contractType: String!
    recipient: RecipientInput!
  }

  type EnvelopeResult {
    envelopeId: String!
    signingUrl: String!
  }

  input GetSigningUrlInput {
    envelopeId: String!
    recipient: RecipientInput!
  }

  type SigningUrlResult {
    signingUrl: String!
  }

  # Audit log entry for tracking envelope actions
  type AuditLog {
    id: String!
    action: String!
    timestamp: String!
    metadata: String
  }

  # Error codes returned in GraphQL error extensions.code - the wire contract
  # shared with the client packages (their generated code and ErrorCodes maps
  # are checked against this enum)
  enum ErrorCode {
    ENVELOPE_NOT_FOUND
    ENVELOPE_CREATION_FAILED
    PROVIDER_UNAVAILABLE
    SESSION_EXPIRED
    UNAUTHORIZED
    VALIDATION_ERROR
    PERSISTENCE_FAILED
  }
`;

export interface ESignGraphQLOptions {
  envelopes: EnvelopeService;
  // Clock for the health query (injectable for tests)
  now?: () => Date;
}

// The SDL plus resolvers bound to an envelope service. Every rule lives in
// the service; the resolvers only map GraphQL inputs and outputs.
export const createESignGraphQL = (options: ESignGraphQLOptions) => {
  const { envelopes } = options;
  const now = options.now ?? (() => new Date());

  const resolvers = {
    Query: {
      health: () => ({ status: 'ok', timestamp: now().toISOString() }),

      // Safe fields only - NEVER the provider's envelope id
      envelope: async (
        _parent: unknown,
        { id }: { id: string },
        context: GraphQLContext,
      ) => {
        const envelope = await envelopes.getEnvelope(context.userId, id);
        return {
          id: envelope.id,
          status: envelope.status,
          contractType: envelope.contractType,
          createdAt: envelope.createdAt.toISOString(),
        };
      },

      auditLogs: async (
        _parent: unknown,
        { envelopeId }: { envelopeId: string },
        context: GraphQLContext,
      ) => {
        const logs = await envelopes.getAuditLogs(context.userId, envelopeId);
        // Metadata travels as a JSON string in GraphQL
        return logs.map(log => ({
          id: log.id,
          action: log.action,
          timestamp: log.timestamp.toISOString(),
          metadata: log.metadata ? JSON.stringify(log.metadata) : null,
        }));
      },
    },

    Mutation: {
      createEnvelope: (
        _parent: unknown,
        { input }: { input: CreateEnvelopeInput },
        context: GraphQLContext,
      ) => envelopes.createEnvelope(context.userId, input),

      // New signing URL for an existing envelope (session restart)
      getSigningUrl: (
        _parent: unknown,
        { input }: { input: GetSigningUrlInput },
        context: GraphQLContext,
      ) => envelopes.getSigningUrl(context.userId, input),
    },
  };

  return { typeDefs, resolvers };
};
