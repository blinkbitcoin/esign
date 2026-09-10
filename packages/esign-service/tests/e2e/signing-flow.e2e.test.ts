// E2E tests for full signing flow lifecycle
// Tests: createEnvelope → getSigningUrl → webhook completion → query
//
// Every step goes through the same app (`envApp()`): the mutations and
// queries over its /graphql route, the webhook over its /webhook/esign
// route. One executor, one provider, one store - which is what makes
// "the webhook completed the envelope the mutation created" mean anything.

import crypto from 'crypto';
import { envApp, graphql, post } from '../support/app';
import { cleanTestData } from './factories';
import { knex } from './setup';

describe('Signing Flow E2E Tests', () => {
  const app = envApp();
  const testHmacKey = 'e2e-signing-flow-hmac-key';

  // Store original env value
  const originalHmacKey = process.env.DOCUSIGN_HMAC_KEY;

  afterAll(async () => {
    await app.stop();
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

      const createResult = await graphql<{
        createEnvelope: { envelopeId: string; signingUrl: string };
      }>(app, createMutation, { input: { contractType: 'purchase_agreement', recipient } }, userId);

      expect(createResult.errors).toBeUndefined();
      const envelopeId = createResult.data!.createEnvelope.envelopeId;
      const signingUrl = createResult.data!.createEnvelope.signingUrl;

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

      const restartResult = await graphql<{ getSigningUrl: { signingUrl: string } }>(
        app,
        getSigningUrlMutation,
        { input: { envelopeId, recipient } },
        userId
      );

      expect(restartResult.errors).toBeUndefined();
      expect(restartResult.data!.getSigningUrl.signingUrl).toContain('/signing/mock/');

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

      const webhookResponse = await post(app, '/webhook/esign', rawBody, {
        'x-docusign-signature-1': validSignature,
      });

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

      const queryResult = await graphql<{
        envelope: { id: string; status: string; contractType: string };
      }>(app, envelopeQuery, { id: envelopeId }, userId);

      expect(queryResult.errors).toBeUndefined();
      expect(queryResult.data!.envelope.status).toBe('completed');
      expect(queryResult.data!.envelope.contractType).toBe('purchase_agreement');

      // Step 5: Verify audit trail
      const auditLogsQuery = `
        query AuditLogs($envelopeId: String!) {
          auditLogs(envelopeId: $envelopeId) {
            action
            metadata
          }
        }
      `;

      const auditResult = await graphql<{
        auditLogs: { action: string; metadata: string | null }[];
      }>(app, auditLogsQuery, { envelopeId }, userId);

      expect(auditResult.errors).toBeUndefined();
      const auditData = auditResult.data!;

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

      const createResult = await graphql<{ createEnvelope: { envelopeId: string } }>(
        app,
        createMutation,
        { input: { contractType: 'test_contract', recipient } },
        userId
      );

      expect(createResult.errors).toBeUndefined();
      const envelopeId = createResult.data!.createEnvelope.envelopeId;

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

      const restartResult = await graphql(
        app,
        getSigningUrlMutation,
        { input: { envelopeId, recipient } },
        userId
      );

      expect(restartResult.errors).toBeDefined();
      expect(restartResult.errors![0].extensions?.code).toBe('VALIDATION_ERROR');
      expect(restartResult.errors![0].message).toContain('Cannot restart');
    });
  });
});
