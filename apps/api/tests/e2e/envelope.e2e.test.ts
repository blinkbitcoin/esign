// E2E tests for envelope CRUD operations
// Tests real database interactions via knex

import { ApolloServer } from '@apollo/server';
import { randomUUID } from 'crypto';

import { resolvers, typeDefs } from '../../src/schema';
import type { GraphQLContext } from '../../src/types';
import { cleanTestData, createTestEnvelope } from './factories';
import { knex } from './setup';

describe('Envelope E2E Tests', () => {
  let server: ApolloServer<GraphQLContext>;

  beforeAll(async () => {
    // Tests exercise resolvers directly via executeOperation(), without going
    // through the HTTP layer, so no Express app instance is needed here.
    server = new ApolloServer<GraphQLContext>({ typeDefs, resolvers });
    await server.start();
  });

  afterAll(async () => {
    await server.stop();
  });

  beforeEach(async () => {
    // Clean data before each test for isolation
    await cleanTestData();
  });

  describe('createEnvelope mutation', () => {
    const CREATE_ENVELOPE_MUTATION = `
      mutation CreateEnvelope($input: CreateEnvelopeInput!) {
        createEnvelope(input: $input) {
          envelopeId
          signingUrl
        }
      }
    `;

    const validInput = {
      contractType: 'loan_agreement',
      recipient: { name: 'John Doe', email: 'john@example.com' },
    };

    it('should persist envelope to database and return envelopeId', async () => {
      // Act - call mutation via ApolloServer.executeOperation
      const response = await server.executeOperation(
        { query: CREATE_ENVELOPE_MUTATION, variables: { input: validInput } },
        { contextValue: { userId: 'e2e-user-123' } }
      );

      // Assert - response contains envelopeId
      expect(response.body.kind).toBe('single');
      if (response.body.kind === 'single') {
        expect(response.body.singleResult.errors).toBeUndefined();
        const data = response.body.singleResult.data as {
          createEnvelope: { envelopeId: string; signingUrl: string };
        };
        expect(data.createEnvelope.envelopeId).toBeDefined();
        expect(data.createEnvelope.signingUrl).toBeDefined();

        // Verify database persistence
        const envelope = await knex('Envelope')
          .where({ id: data.createEnvelope.envelopeId })
          .first();

        expect(envelope).not.toBeUndefined();
        expect(envelope!.userId).toBe('e2e-user-123');
        expect(envelope!.contractType).toBe('loan_agreement');
        expect(envelope!.status).toBe('sent');
        expect(envelope!.providerEnvelopeId).toBeDefined();
      }
    });

    it('should create audit log when envelope is created', async () => {
      // Act
      const response = await server.executeOperation(
        { query: CREATE_ENVELOPE_MUTATION, variables: { input: validInput } },
        { contextValue: { userId: 'e2e-user-456' } }
      );

      // Assert - audit log created
      expect(response.body.kind).toBe('single');
      if (response.body.kind === 'single') {
        const data = response.body.singleResult.data as {
          createEnvelope: { envelopeId: string };
        };

        const auditLogs = await knex('AuditLog').where({
          envelopeId: data.createEnvelope.envelopeId,
        });

        expect(auditLogs).toHaveLength(1);
        expect(auditLogs[0].action).toBe('initiated');
        expect(auditLogs[0].metadata).toMatchObject({
          contractType: 'loan_agreement',
          userId: 'e2e-user-456',
        });
      }
    });
  });

  describe('envelope query', () => {
    const ENVELOPE_QUERY = `
      query GetEnvelope($id: String!) {
        envelope(id: $id) {
          id
          status
          contractType
          createdAt
        }
      }
    `;

    it('should return envelope by ID for owner', async () => {
      // Arrange - create envelope directly in database
      const envelope = await createTestEnvelope({
        userId: 'e2e-user-owner',
        contractType: 'rental_agreement',
        status: 'sent',
      });

      // Act
      const response = await server.executeOperation(
        { query: ENVELOPE_QUERY, variables: { id: envelope.id } },
        { contextValue: { userId: 'e2e-user-owner' } }
      );

      // Assert
      expect(response.body.kind).toBe('single');
      if (response.body.kind === 'single') {
        expect(response.body.singleResult.errors).toBeUndefined();
        const data = response.body.singleResult.data as {
          envelope: { id: string; status: string; contractType: string };
        };
        expect(data.envelope.id).toBe(envelope.id);
        expect(data.envelope.status).toBe('sent');
        expect(data.envelope.contractType).toBe('rental_agreement');
      }
    });

    it('should return ENVELOPE_NOT_FOUND for non-owner', async () => {
      // Arrange - create envelope for different user
      const envelope = await createTestEnvelope({
        userId: 'e2e-user-other',
      });

      // Act - query as different user
      const response = await server.executeOperation(
        { query: ENVELOPE_QUERY, variables: { id: envelope.id } },
        { contextValue: { userId: 'e2e-user-attacker' } }
      );

      // Assert - should not leak existence
      expect(response.body.kind).toBe('single');
      if (response.body.kind === 'single') {
        expect(response.body.singleResult.errors).toBeDefined();
        expect(response.body.singleResult.errors![0].extensions?.code).toBe('ENVELOPE_NOT_FOUND');
      }
    });
  });

  describe('auditLogs query', () => {
    const AUDIT_LOGS_QUERY = `
      query AuditLogs($envelopeId: String!) {
        auditLogs(envelopeId: $envelopeId) {
          id
          action
          timestamp
          metadata
        }
      }
    `;

    it('should return audit logs for owned envelope', async () => {
      // Arrange - create envelope and audit logs
      const envelope = await createTestEnvelope({
        userId: 'e2e-user-logs',
      });
      await knex('AuditLog').insert([
        {
          id: randomUUID(),
          envelopeId: envelope.id,
          action: 'initiated',
          metadata: { test: 'data1' },
        },
        {
          id: randomUUID(),
          envelopeId: envelope.id,
          action: 'completed',
          metadata: { test: 'data2' },
        },
      ]);

      // Act
      const response = await server.executeOperation(
        { query: AUDIT_LOGS_QUERY, variables: { envelopeId: envelope.id } },
        { contextValue: { userId: 'e2e-user-logs' } }
      );

      // Assert
      expect(response.body.kind).toBe('single');
      if (response.body.kind === 'single') {
        expect(response.body.singleResult.errors).toBeUndefined();
        const data = response.body.singleResult.data as {
          auditLogs: { action: string }[];
        };
        expect(data.auditLogs).toHaveLength(2);
        // Verify actions are present (order may vary based on timestamp)
        const actions = data.auditLogs.map((log) => log.action);
        expect(actions).toContain('initiated');
        expect(actions).toContain('completed');
      }
    });
  });
});
