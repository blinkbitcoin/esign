// E2E tests for full signing flow lifecycle
// Tests: createEnvelope → getSigningUrl → webhook completion → query

import { ApolloServer } from '@apollo/server';
import crypto from 'crypto';
import type { Express } from 'express';
import request from 'supertest';
import { createApp } from '../../src/app';
import { resolvers, typeDefs } from '../../src/schema';
import type { GraphQLContext } from '../../src/types';
import { cleanTestData } from './factories';
import { knex } from './setup';

describe('Signing Flow E2E Tests', () => {
  let app: Express;
  let server: ApolloServer<GraphQLContext>;
  const testHmacKey = 'e2e-signing-flow-hmac-key';

  // Store original env value
  const originalHmacKey = process.env.DOCUSIGN_HMAC_KEY;

  beforeAll(async () => {
    app = await createApp();
    server = new ApolloServer<GraphQLContext>({ typeDefs, resolvers });
    await server.start();
  });

  afterAll(async () => {
    await server.stop();
  });

  beforeEach(async () => {
    await cleanTestData();
    process.env.DOCUSIGN_HMAC_KEY = testHmacKey;
  });

  afterEach(() => {
    if (originalHmacKey !== undefined) {
      process.env.DOCUSIGN_HMAC_KEY = originalHmacKey;
    } else {
      delete process.env.DOCUSIGN_HMAC_KEY;
    }
  });

  // Helper to compute valid HMAC signature
  const computeSignature = (body: string, key: string): string => {
    return crypto.createHmac('sha256', key).update(body, 'utf8').digest('base64');
  };

  describe('Full signing lifecycle', () => {
    it('should complete full flow: create → restart → webhook → query', async () => {
      const userId = 'e2e-signing-flow-user';
      const recipient = { name: 'Jane Signer', email: 'jane@example.com' };

      // Step 1: Create envelope
      const createMutation = `
        mutation CreateEnvelope($input: CreateEnvelopeInput!) {
          createEnvelope(input: $input) {
            envelopeId
            signingUrl
          }
        }
      `;

      const createResponse = await server.executeOperation(
        {
          query: createMutation,
          variables: {
            input: {
              contractType: 'purchase_agreement',
              recipient,
            },
          },
        },
        { contextValue: { userId } }
      );

      expect(createResponse.body.kind).toBe('single');
      if (createResponse.body.kind !== 'single') return;

      expect(createResponse.body.singleResult.errors).toBeUndefined();
      const createData = createResponse.body.singleResult.data as {
        createEnvelope: { envelopeId: string; signingUrl: string };
      };

      const envelopeId = createData.createEnvelope.envelopeId;
      const signingUrl = createData.createEnvelope.signingUrl;

      expect(envelopeId).toBeDefined();
      expect(signingUrl).toContain('/signing/mock/');

      // Verify initial state in database
      const initialEnvelope = await knex('Envelope').where({ id: envelopeId }).first();
      expect(initialEnvelope).not.toBeUndefined();
      expect(initialEnvelope!.status).toBe('sent');
      expect(initialEnvelope!.contractType).toBe('purchase_agreement');

      // Step 2: Get new signing URL (session restart)
      const getSigningUrlMutation = `
        mutation GetSigningUrl($input: GetSigningUrlInput!) {
          getSigningUrl(input: $input) {
            signingUrl
          }
        }
      `;

      const restartResponse = await server.executeOperation(
        {
          query: getSigningUrlMutation,
          variables: {
            input: {
              envelopeId,
              recipient,
            },
          },
        },
        { contextValue: { userId } }
      );

      expect(restartResponse.body.kind).toBe('single');
      if (restartResponse.body.kind !== 'single') return;

      expect(restartResponse.body.singleResult.errors).toBeUndefined();
      const restartData = restartResponse.body.singleResult.data as {
        getSigningUrl: { signingUrl: string };
      };
      expect(restartData.getSigningUrl.signingUrl).toContain('/signing/mock/');

      // Step 3: Simulate webhook completion
      const envelope = await knex('Envelope').where({ id: envelopeId }).first();

      const webhookPayload = {
        event: 'envelope-completed',
        apiVersion: 'v2.1',
        uri: '/restapi/v2.1/accounts/xxx/envelopes/xxx',
        retryCount: 0,
        configurationId: 12345,
        generatedDateTime: new Date().toISOString(),
        data: {
          accountId: 'account-123',
          userId: 'user-456',
          envelopeId: envelope!.providerEnvelopeId, // Use the actual providerEnvelopeId
          envelopeSummary: {
            status: 'completed',
            emailSubject: 'Purchase Agreement',
          },
        },
      };

      const rawBody = JSON.stringify(webhookPayload);
      const validSignature = computeSignature(rawBody, testHmacKey);

      const webhookResponse = await request(app)
        .post('/webhook/esign')
        .set('x-docusign-signature-1', validSignature)
        .set('Content-Type', 'application/json')
        .send(rawBody);

      expect(webhookResponse.status).toBe(200);

      // Step 4: Query envelope to verify completion
      const envelopeQuery = `
        query GetEnvelope($id: String!) {
          envelope(id: $id) {
            id
            status
            contractType
          }
        }
      `;

      const queryResponse = await server.executeOperation(
        { query: envelopeQuery, variables: { id: envelopeId } },
        { contextValue: { userId } }
      );

      expect(queryResponse.body.kind).toBe('single');
      if (queryResponse.body.kind !== 'single') return;

      expect(queryResponse.body.singleResult.errors).toBeUndefined();
      const queryData = queryResponse.body.singleResult.data as {
        envelope: { id: string; status: string; contractType: string };
      };

      expect(queryData.envelope.status).toBe('completed');
      expect(queryData.envelope.contractType).toBe('purchase_agreement');

      // Step 5: Verify audit trail
      const auditLogsQuery = `
        query AuditLogs($envelopeId: String!) {
          auditLogs(envelopeId: $envelopeId) {
            action
            metadata
          }
        }
      `;

      const auditResponse = await server.executeOperation(
        { query: auditLogsQuery, variables: { envelopeId } },
        { contextValue: { userId } }
      );

      expect(auditResponse.body.kind).toBe('single');
      if (auditResponse.body.kind !== 'single') return;

      expect(auditResponse.body.singleResult.errors).toBeUndefined();
      const auditData = auditResponse.body.singleResult.data as {
        auditLogs: { action: string; metadata: string | null }[];
      };

      // Verify all expected audit actions are present
      const actions = auditData.auditLogs.map((log) => log.action);
      expect(actions).toContain('initiated'); // From createEnvelope
      expect(actions).toContain('session_restart'); // From getSigningUrl
      expect(actions).toContain('completed'); // From webhook

      // Verify completed action has webhook source
      const completedLog = auditData.auditLogs.find((log) => log.action === 'completed');
      expect(completedLog).toBeDefined();
      const metadata = JSON.parse(completedLog!.metadata!);
      expect(metadata.source).toBe('webhook');
    });

    it('should not allow restart after completion', async () => {
      const userId = 'e2e-no-restart-user';
      const recipient = { name: 'No Restart', email: 'no-restart@example.com' };

      // Create and complete envelope
      const createMutation = `
        mutation CreateEnvelope($input: CreateEnvelopeInput!) {
          createEnvelope(input: $input) {
            envelopeId
          }
        }
      `;

      const createResponse = await server.executeOperation(
        {
          query: createMutation,
          variables: { input: { contractType: 'test_contract', recipient } },
        },
        { contextValue: { userId } }
      );

      expect(createResponse.body.kind).toBe('single');
      if (createResponse.body.kind !== 'single') return;

      const envelopeId = (
        createResponse.body.singleResult.data as {
          createEnvelope: { envelopeId: string };
        }
      ).createEnvelope.envelopeId;

      // Manually set status to completed (simulating webhook)
      await knex('Envelope').where({ id: envelopeId }).update({ status: 'completed' });

      // Try to restart - should fail
      const getSigningUrlMutation = `
        mutation GetSigningUrl($input: GetSigningUrlInput!) {
          getSigningUrl(input: $input) {
            signingUrl
          }
        }
      `;

      const restartResponse = await server.executeOperation(
        {
          query: getSigningUrlMutation,
          variables: { input: { envelopeId, recipient } },
        },
        { contextValue: { userId } }
      );

      expect(restartResponse.body.kind).toBe('single');
      if (restartResponse.body.kind !== 'single') return;

      expect(restartResponse.body.singleResult.errors).toBeDefined();
      expect(restartResponse.body.singleResult.errors![0].extensions?.code).toBe(
        'VALIDATION_ERROR'
      );
      expect(restartResponse.body.singleResult.errors![0].message).toContain('Cannot restart');
    });
  });
});
