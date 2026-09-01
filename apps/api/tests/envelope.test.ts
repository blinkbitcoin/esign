// Tests for envelope repository functions
// Uses a mocked knex client (knex-mock-client) to avoid a real Postgres connection

import type { Tracker } from 'knex-mock-client';
import { createTracker } from 'knex-mock-client';
import { knex } from '../src/db';
import {
  createEnvelope,
  getEnvelopeById,
  getEnvelopeByIdForUser,
  getEnvelopeByProviderEnvelopeId,
  updateEnvelopeStatus,
} from '../src/envelope';

describe('Envelope Repository', () => {
  let tracker: Tracker;

  beforeAll(() => {
    tracker = createTracker(knex);
  });

  afterEach(() => {
    tracker.reset();
  });

  describe('createEnvelope', () => {
    it('should save envelope with correct fields', async () => {
      // Arrange
      const data = {
        providerEnvelopeId: 'docusign-test-123',
        userId: 'user-456',
        contractType: 'loan_agreement',
      };

      const mockEnvelope = {
        id: 'uuid-123-456-789',
        providerEnvelopeId: 'docusign-test-123',
        userId: 'user-456',
        contractType: 'loan_agreement',
        status: 'sent',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      tracker.on.insert('Envelope').response([mockEnvelope]);

      // Act
      const envelope = await createEnvelope(data);

      // Assert
      const insertHistory = tracker.history.insert;
      expect(insertHistory).toHaveLength(1);
      expect(insertHistory[0].bindings).toEqual(
        expect.arrayContaining(['docusign-test-123', 'user-456', 'loan_agreement', 'sent'])
      );
      expect(envelope.id).toBe('uuid-123-456-789');
      expect(envelope.providerEnvelopeId).toBe('docusign-test-123');
      expect(envelope.userId).toBe('user-456');
      expect(envelope.contractType).toBe('loan_agreement');
      expect(envelope.status).toBe('sent');
    });

    it('should generate unique internal IDs', async () => {
      // Arrange - mock two different envelope creations
      tracker.on.insert('Envelope').responseOnce([
        {
          id: 'uuid-1',
          providerEnvelopeId: 'docusign-1',
          userId: 'user-1',
          contractType: 'contract_a',
          status: 'sent',
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ]);
      tracker.on.insert('Envelope').responseOnce([
        {
          id: 'uuid-2',
          providerEnvelopeId: 'docusign-2',
          userId: 'user-1',
          contractType: 'contract_b',
          status: 'sent',
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ]);

      // Act
      const envelope1 = await createEnvelope({
        providerEnvelopeId: 'docusign-1',
        userId: 'user-1',
        contractType: 'contract_a',
      });

      const envelope2 = await createEnvelope({
        providerEnvelopeId: 'docusign-2',
        userId: 'user-1',
        contractType: 'contract_b',
      });

      // Assert
      expect(envelope1.id).not.toBe(envelope2.id);
    });
  });

  describe('getEnvelopeByIdForUser', () => {
    it('should return envelope for correct userId', async () => {
      // Arrange
      const mockEnvelope = {
        id: 'uuid-owner-test',
        providerEnvelopeId: 'docusign-owner-test',
        userId: 'owner-user',
        contractType: 'loan',
        status: 'sent',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      tracker.on.select('Envelope').response([mockEnvelope]);

      // Act
      const result = await getEnvelopeByIdForUser('uuid-owner-test', 'owner-user');

      // Assert
      const selectHistory = tracker.history.select;
      expect(selectHistory).toHaveLength(1);
      expect(selectHistory[0].bindings).toEqual(
        expect.arrayContaining(['uuid-owner-test', 'owner-user'])
      );
      expect(result).not.toBeNull();
      expect(result?.id).toBe('uuid-owner-test');
    });

    it('should return null for wrong userId (no information leak)', async () => {
      // Arrange - returns no rows when userId doesn't match
      tracker.on.select('Envelope').response([]);

      // Act
      const result = await getEnvelopeByIdForUser('uuid-secret', 'different-user');

      // Assert - returns null, doesn't throw or reveal envelope exists
      expect(result).toBeNull();
    });

    it('should return null for non-existent envelope', async () => {
      // Arrange
      tracker.on.select('Envelope').response([]);

      // Act
      const result = await getEnvelopeByIdForUser(
        '00000000-0000-0000-0000-000000000000',
        'any-user'
      );

      // Assert
      expect(result).toBeNull();
    });
  });

  describe('getEnvelopeById', () => {
    it('should return envelope by internal ID', async () => {
      // Arrange
      const mockEnvelope = {
        id: 'uuid-internal',
        providerEnvelopeId: 'docusign-internal',
        userId: 'user-internal',
        contractType: 'internal_test',
        status: 'sent',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      tracker.on.select('Envelope').response([mockEnvelope]);

      // Act
      const result = await getEnvelopeById('uuid-internal');

      // Assert
      const selectHistory = tracker.history.select;
      expect(selectHistory).toHaveLength(1);
      expect(selectHistory[0].bindings).toEqual(expect.arrayContaining(['uuid-internal']));
      expect(result).not.toBeNull();
      expect(result?.providerEnvelopeId).toBe('docusign-internal');
    });

    it('should return null when no envelope matches the internal ID', async () => {
      // Arrange
      tracker.on.select('Envelope').response([]);

      // Act
      const result = await getEnvelopeById('uuid-does-not-exist');

      // Assert
      expect(result).toBeNull();
    });
  });

  describe('getEnvelopeByProviderEnvelopeId', () => {
    it('should return envelope by DocuSign ID (for webhooks)', async () => {
      // Arrange
      const mockEnvelope = {
        id: 'uuid-webhook',
        providerEnvelopeId: 'docusign-webhook-123',
        userId: 'webhook-user',
        contractType: 'webhook_contract',
        status: 'sent',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      tracker.on.select('Envelope').response([mockEnvelope]);

      // Act
      const result = await getEnvelopeByProviderEnvelopeId('docusign-webhook-123');

      // Assert
      const selectHistory = tracker.history.select;
      expect(selectHistory).toHaveLength(1);
      expect(selectHistory[0].bindings).toEqual(expect.arrayContaining(['docusign-webhook-123']));
      expect(result).not.toBeNull();
      expect(result?.id).toBe('uuid-webhook');
    });

    it('should return null when no envelope matches the providerEnvelopeId', async () => {
      // Arrange
      tracker.on.select('Envelope').response([]);

      // Act
      const result = await getEnvelopeByProviderEnvelopeId('docusign-does-not-exist');

      // Assert
      expect(result).toBeNull();
    });
  });

  describe('updateEnvelopeStatus', () => {
    it('should update status to completed', async () => {
      // Arrange
      const mockUpdated = {
        id: 'uuid-complete',
        providerEnvelopeId: 'docusign-complete',
        userId: 'user-complete',
        contractType: 'complete_test',
        status: 'completed',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      tracker.on.update('Envelope').response([mockUpdated]);

      // Act
      const updated = await updateEnvelopeStatus('uuid-complete', 'completed');

      // Assert
      const updateHistory = tracker.history.update;
      expect(updateHistory).toHaveLength(1);
      expect(updateHistory[0].bindings).toEqual(
        expect.arrayContaining(['completed', 'uuid-complete'])
      );
      expect(updated.status).toBe('completed');
    });

    it('should update status to voided', async () => {
      // Arrange
      const mockUpdated = {
        id: 'uuid-void',
        providerEnvelopeId: 'docusign-void',
        userId: 'user-void',
        contractType: 'void_test',
        status: 'voided',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      tracker.on.update('Envelope').response([mockUpdated]);

      // Act
      const updated = await updateEnvelopeStatus('uuid-void', 'voided');

      // Assert
      expect(updated.status).toBe('voided');
    });

    it('should update status to declined', async () => {
      // Arrange
      const mockUpdated = {
        id: 'uuid-decline',
        providerEnvelopeId: 'docusign-decline',
        userId: 'user-decline',
        contractType: 'decline_test',
        status: 'declined',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      tracker.on.update('Envelope').response([mockUpdated]);

      // Act
      const updated = await updateEnvelopeStatus('uuid-decline', 'declined');

      // Assert
      const updateHistory = tracker.history.update;
      expect(updateHistory).toHaveLength(1);
      expect(updateHistory[0].bindings).toEqual(
        expect.arrayContaining(['declined', 'uuid-decline'])
      );
      expect(updated.status).toBe('declined');
    });

    it('should throw when the envelope does not exist', async () => {
      // Arrange - no matching row, so UPDATE ... RETURNING yields no rows
      tracker.on.update('Envelope').response([]);

      // Act & Assert
      await expect(updateEnvelopeStatus('uuid-missing', 'completed')).rejects.toThrow(
        'Envelope not found: uuid-missing'
      );
    });
  });
});
