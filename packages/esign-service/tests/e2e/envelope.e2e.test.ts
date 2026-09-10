// E2E tests for envelope CRUD operations against a real database.
//
// Driven through the app's own /graphql route (`envApp()`), not through a
// second ApolloServer composed beside it: the executor, the provider and the
// store under test are the ones the service serves with, so this suite
// proves the wiring and not just the domain.

import { randomUUID } from 'crypto';

import { envApp, graphql } from '../support/app';
import { cleanTestData, createTestEnvelope } from './factories';
import { knex } from './setup';

describe('Envelope E2E Tests', () => {
  const app = envApp();

  afterAll(async () => {
    await app.stop();
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
      // Act - call the mutation over the app's /graphql route
      const result = await graphql<{
        createEnvelope: { envelopeId: string; signingUrl: string };
      }>(app, CREATE_ENVELOPE_MUTATION, { input: validInput }, 'e2e-user-123');

      // Assert - response contains envelopeId
      expect(result.errors).toBeUndefined();
      expect(result.data!.createEnvelope.envelopeId).toBeDefined();
      expect(result.data!.createEnvelope.signingUrl).toBeDefined();

      // Verify database persistence
      const envelope = await knex('Envelope')
        .where({ id: result.data!.createEnvelope.envelopeId })
        .first();

      expect(envelope).not.toBeUndefined();
      expect(envelope!.userId).toBe('e2e-user-123');
      expect(envelope!.contractType).toBe('loan_agreement');
      expect(envelope!.status).toBe('sent');
      expect(envelope!.providerEnvelopeId).toBeDefined();
    });

    it('should create audit log when envelope is created', async () => {
      // Act
      const result = await graphql<{ createEnvelope: { envelopeId: string } }>(
        app,
        CREATE_ENVELOPE_MUTATION,
        { input: validInput },
        'e2e-user-456'
      );

      // Assert - audit log created
      expect(result.errors).toBeUndefined();
      const auditLogs = await knex('AuditLog').where({
        envelopeId: result.data!.createEnvelope.envelopeId,
      });

      expect(auditLogs).toHaveLength(1);
      expect(auditLogs[0].action).toBe('initiated');
      expect(auditLogs[0].metadata).toMatchObject({
        contractType: 'loan_agreement',
        userId: 'e2e-user-456',
      });
    });

    it('should refuse an unauthenticated caller', async () => {
      const result = await graphql(app, CREATE_ENVELOPE_MUTATION, { input: validInput });

      expect(result.errors![0].extensions?.code).toBe('UNAUTHORIZED');
      expect(await knex('Envelope').select('id')).toHaveLength(0);
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
      const result = await graphql<{
        envelope: { id: string; status: string; contractType: string };
      }>(app, ENVELOPE_QUERY, { id: envelope.id }, 'e2e-user-owner');

      // Assert
      expect(result.errors).toBeUndefined();
      expect(result.data!.envelope.id).toBe(envelope.id);
      expect(result.data!.envelope.status).toBe('sent');
      expect(result.data!.envelope.contractType).toBe('rental_agreement');
    });

    it('should return ENVELOPE_NOT_FOUND for non-owner', async () => {
      // Arrange - create envelope for different user
      const envelope = await createTestEnvelope({
        userId: 'e2e-user-other',
      });

      // Act - query as different user
      const result = await graphql(app, ENVELOPE_QUERY, { id: envelope.id }, 'e2e-user-attacker');

      // Assert - should not leak existence
      expect(result.errors).toBeDefined();
      expect(result.errors![0].extensions?.code).toBe('ENVELOPE_NOT_FOUND');
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
      const result = await graphql<{ auditLogs: { action: string }[] }>(
        app,
        AUDIT_LOGS_QUERY,
        { envelopeId: envelope.id },
        'e2e-user-logs'
      );

      // Assert
      expect(result.errors).toBeUndefined();
      expect(result.data!.auditLogs).toHaveLength(2);
      // Verify actions are present (order may vary based on timestamp)
      const actions = result.data!.auditLogs.map((log) => log.action);
      expect(actions).toContain('initiated');
      expect(actions).toContain('completed');
    });
  });
});
