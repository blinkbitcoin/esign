// GraphQL schema and resolvers: the wire layer over the envelope service.
// Authorization, validation, persistence and the audit trail live in the
// service (@blinkbitcoin/esign-server); the resolvers only map GraphQL
// inputs and outputs.

import { envelopeService } from './services';
import type { CreateEnvelopeInput, GetSigningUrlInput, GraphQLContext } from './types';

export { typeDefs } from './typeDefs';

export const resolvers = {
  Query: {
    health: () => ({
      status: 'ok',
      timestamp: new Date().toISOString(),
    }),

    // Safe fields only - NEVER the provider's envelope id
    envelope: async (_parent: unknown, { id }: { id: string }, context: GraphQLContext) => {
      const envelope = await envelopeService.getEnvelope(context.userId, id);
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
      context: GraphQLContext
    ) => {
      const logs = await envelopeService.getAuditLogs(context.userId, envelopeId);
      // Metadata travels as a JSON string in GraphQL
      return logs.map((log) => ({
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
      context: GraphQLContext
    ) => envelopeService.createEnvelope(context.userId, input),

    // New signing URL for an existing envelope (session restart)
    getSigningUrl: (
      _parent: unknown,
      { input }: { input: GetSigningUrlInput },
      context: GraphQLContext
    ) => envelopeService.getSigningUrl(context.userId, input),
  },
};
