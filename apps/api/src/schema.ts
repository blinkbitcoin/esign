// GraphQL schema and resolvers for e-signature API
// Implements createEnvelope mutation with authorization and persistence

import { getAuditLogsByEnvelopeId, logAuditEvent } from './audit';
import { knex } from './db';
import { createEnvelope, getEnvelopeByIdForUser } from './envelope';
import { Errors } from './errors';
import { provider } from './providers';
import type { CreateEnvelopeInput, GraphQLContext, RecipientData } from './types';

export { typeDefs } from './typeDefs';

// Max lengths for free-text inputs - bounds storage/log amplification from
// oversized values (email is naturally bounded by the format check).
const MAX_CONTRACT_TYPE_LENGTH = 100;
const MAX_NAME_LENGTH = 200;

// Simple email format validation (basic check for @ and domain)
const isValidEmail = (email: string): boolean => {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
};

// GraphQL resolvers
export const resolvers = {
  Query: {
    health: () => ({
      status: 'ok',
      timestamp: new Date().toISOString(),
    }),

    // Query envelope by ID with ownership check
    // Returns UNAUTHORIZED if no userId, ENVELOPE_NOT_FOUND if missing or wrong owner
    envelope: async (_parent: unknown, { id }: { id: string }, context: GraphQLContext) => {
      // Authorization check - userId must be present in context
      if (!context.userId) {
        throw Errors.unauthorized();
      }

      // Input validation - id must be non-empty
      if (!id || id.trim() === '') {
        throw Errors.validationError('id is required and cannot be empty');
      }

      // Query with ownership check - returns null if not found OR user doesn't own it
      const envelope = await getEnvelopeByIdForUser(id, context.userId);

      if (!envelope) {
        throw Errors.envelopeNotFound();
      }

      // Return only safe fields - NEVER expose providerEnvelopeId
      return {
        id: envelope.id,
        status: envelope.status,
        contractType: envelope.contractType,
        createdAt: envelope.createdAt.toISOString(),
      };
    },

    // Query audit logs by envelope ID with ownership check
    // Returns UNAUTHORIZED if no userId, ENVELOPE_NOT_FOUND if envelope missing or wrong owner
    auditLogs: async (
      _parent: unknown,
      { envelopeId }: { envelopeId: string },
      context: GraphQLContext
    ) => {
      // Authorization check - userId must be present in context
      if (!context.userId) {
        throw Errors.unauthorized();
      }

      // Input validation - envelopeId must be non-empty
      if (!envelopeId || envelopeId.trim() === '') {
        throw Errors.validationError('envelopeId is required and cannot be empty');
      }

      // Query with ownership check - returns null if not found OR user doesn't own it
      const envelope = await getEnvelopeByIdForUser(envelopeId, context.userId);

      if (!envelope) {
        throw Errors.envelopeNotFound();
      }

      // Get audit logs for this envelope (ordered by timestamp desc)
      const logs = await getAuditLogsByEnvelopeId(envelopeId);

      // Return logs with metadata serialized to JSON string for GraphQL
      return logs.map((log) => ({
        id: log.id,
        action: log.action,
        timestamp: log.timestamp.toISOString(),
        metadata: log.metadata ? JSON.stringify(log.metadata) : null,
      }));
    },
  },
  Mutation: {
    createEnvelope: async (
      _parent: unknown,
      { input }: { input: CreateEnvelopeInput },
      context: GraphQLContext
    ) => {
      // Authorization check - userId must be present in context
      if (!context.userId) {
        throw Errors.unauthorized();
      }

      // Input validation - contractType must be non-empty and bounded
      if (!input.contractType || input.contractType.trim() === '') {
        throw Errors.validationError('contractType is required and cannot be empty');
      }
      if (input.contractType.length > MAX_CONTRACT_TYPE_LENGTH) {
        throw Errors.validationError(
          `contractType must be at most ${MAX_CONTRACT_TYPE_LENGTH} characters`
        );
      }

      // Input validation - recipient name must be non-empty and bounded
      if (!input.recipient.name || input.recipient.name.trim() === '') {
        throw Errors.validationError('recipient.name is required and cannot be empty');
      }
      if (input.recipient.name.length > MAX_NAME_LENGTH) {
        throw Errors.validationError(
          `recipient.name must be at most ${MAX_NAME_LENGTH} characters`
        );
      }

      // Input validation - recipient email must be valid format
      if (!input.recipient.email || !isValidEmail(input.recipient.email)) {
        throw Errors.validationError('recipient.email must be a valid email address');
      }

      // Call the configured e-signature provider to create the envelope
      // Log failures server-side for debugging (no PII)
      let providerResult;
      try {
        providerResult = await provider.createEnvelope(
          context.userId,
          input.contractType,
          input.recipient
        );
      } catch (providerError) {
        // Log failure server-side with metadata for debugging (no PII)
        // Extract error code safely from GraphQL error or fallback to UNKNOWN_ERROR
        let errorCode = 'UNKNOWN_ERROR';
        if (providerError && typeof providerError === 'object') {
          const err = providerError as { extensions?: { code?: string }; code?: string };
          errorCode = err.extensions?.code || err.code || 'UNKNOWN_ERROR';
        }
        // Logged as an object: console runs it through util.inspect, which
        // quotes/escapes string fields, so client-influenced values here
        // can't forge log lines (unlike raw string interpolation).
        console.error('Envelope creation failed:', {
          action: 'creation_failed',
          errorCode,
          contractType: input.contractType,
          userId: context.userId,
          timestamp: new Date().toISOString(),
          // Note: No PII logged - no email, name, or document content
        });
        throw providerError; // Re-throw to client
      }

      // Save envelope and audit log in a transaction for data consistency
      // If either fails, both are rolled back
      try {
        const envelope = await knex.transaction(async (trx) => {
          // Save envelope to database with internal UUID
          // Provider's envelopeId becomes providerEnvelopeId (never exposed to client)
          const created = await createEnvelope(
            {
              providerEnvelopeId: providerResult.envelopeId,
              userId: context.userId!, // Safe: checked at start of resolver
              contractType: input.contractType,
            },
            trx
          );

          // Log audit event for envelope creation within same transaction
          await logAuditEvent(
            created.id,
            'initiated',
            {
              contractType: input.contractType,
              userId: context.userId!, // Safe: checked at start of resolver
            },
            trx
          );

          return created;
        });

        // Return internal UUID (not providerEnvelopeId) to client
        return {
          envelopeId: envelope.id,
          signingUrl: providerResult.signingUrl,
        };
      } catch (error) {
        // Log error server-side for debugging (no PII)
        console.error(
          'Failed to persist envelope:',
          error instanceof Error ? error.message : error
        );
        throw Errors.persistenceFailed();
      }
    },

    // Get new signing URL for existing envelope (session restart)
    getSigningUrl: async (
      _parent: unknown,
      { input }: { input: { envelopeId: string; recipient: RecipientData } },
      context: GraphQLContext
    ) => {
      // Authorization check - userId must be present in context
      if (!context.userId) {
        throw Errors.unauthorized();
      }

      // Input validation - envelopeId must be non-empty
      if (!input.envelopeId || input.envelopeId.trim() === '') {
        throw Errors.validationError('envelopeId is required and cannot be empty');
      }

      // Input validation - recipient name must be non-empty and bounded
      if (!input.recipient.name || input.recipient.name.trim() === '') {
        throw Errors.validationError('recipient.name is required and cannot be empty');
      }
      if (input.recipient.name.length > MAX_NAME_LENGTH) {
        throw Errors.validationError(
          `recipient.name must be at most ${MAX_NAME_LENGTH} characters`
        );
      }

      // Input validation - recipient email must be valid format
      if (!input.recipient.email || !isValidEmail(input.recipient.email)) {
        throw Errors.validationError('recipient.email must be a valid email address');
      }

      // Get envelope with ownership check
      const envelope = await getEnvelopeByIdForUser(input.envelopeId, context.userId);

      if (!envelope) {
        throw Errors.envelopeNotFound();
      }

      // Only allow restart for envelopes in 'sent' status
      if (envelope.status !== 'sent') {
        throw Errors.validationError('Cannot restart signing for completed or voided envelope');
      }

      // Call provider to get new signing URL using the provider envelope ID
      const result = await provider.getSigningUrl(envelope.providerEnvelopeId, input.recipient);

      // Log audit event for session restart
      await logAuditEvent(envelope.id, 'session_restart', {
        userId: context.userId,
      });

      return {
        signingUrl: result.signingUrl,
      };
    },
  },
};
