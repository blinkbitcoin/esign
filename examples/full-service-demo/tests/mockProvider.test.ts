import { ErrorCodes } from '../src/errors';
import {
  addEnvelope,
  clearEnvelopes,
  MockProvider,
  setEnvelopeStatus,
} from '../src/providers/mock';

describe('MockProvider', () => {
  beforeEach(() => {
    clearEnvelopes();
  });

  describe('createEnvelope', () => {
    it('should return valid envelope result with UUID', async () => {
      // Arrange
      const userId = 'user-123';
      const contractType = 'loan_agreement';
      const recipient = { name: 'John Doe', email: 'john@example.com' };

      // Act
      const result = await MockProvider.createEnvelope(userId, contractType, recipient);

      // Assert
      expect(result.envelopeId).toBeDefined();
      expect(result.envelopeId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
      );
    });

    it('should return signing URL containing envelope ID', async () => {
      // Arrange
      const userId = 'user-123';
      const contractType = 'loan_agreement';
      const recipient = { name: 'John Doe', email: 'john@example.com' };
      const expectedPort = process.env.PORT || 4000;

      // Act
      const result = await MockProvider.createEnvelope(userId, contractType, recipient);

      // Assert
      expect(result.signingUrl).toContain(result.envelopeId);
      expect(result.signingUrl).toBe(
        `http://localhost:${expectedPort}/signing/mock/${result.envelopeId}`
      );
    });

    it('should store envelope with sent status', async () => {
      // Arrange
      const userId = 'user-123';
      const contractType = 'loan_agreement';
      const recipient = { name: 'Jane Doe', email: 'jane@example.com' };

      // Act
      const result = await MockProvider.createEnvelope(userId, contractType, recipient);
      const status = await MockProvider.getEnvelopeStatus(result.envelopeId);

      // Assert
      expect(status).toBe('sent');
    });

    it('should create unique envelope IDs for each call', async () => {
      // Arrange
      const userId = 'user-123';
      const contractType = 'loan_agreement';
      const recipient = { name: 'John Doe', email: 'john@example.com' };

      // Act
      const result1 = await MockProvider.createEnvelope(userId, contractType, recipient);
      const result2 = await MockProvider.createEnvelope(userId, contractType, recipient);

      // Assert
      expect(result1.envelopeId).not.toBe(result2.envelopeId);
    });
  });

  describe('getEnvelopeStatus', () => {
    it('should return status for existing envelope', async () => {
      // Arrange
      const userId = 'user-123';
      const contractType = 'loan_agreement';
      const recipient = { name: 'John Doe', email: 'john@example.com' };
      const { envelopeId } = await MockProvider.createEnvelope(userId, contractType, recipient);

      // Act
      const status = await MockProvider.getEnvelopeStatus(envelopeId);

      // Assert
      expect(status).toBe('sent');
    });

    it('should throw ENVELOPE_NOT_FOUND for unknown envelope', async () => {
      // Arrange
      const unknownId = 'non-existent-envelope-id';

      // Act & Assert
      await expect(MockProvider.getEnvelopeStatus(unknownId)).rejects.toMatchObject({
        extensions: { code: ErrorCodes.ENVELOPE_NOT_FOUND },
      });
    });
  });

  describe('getSigningUrl', () => {
    it('should return a restart signing URL for existing envelope', async () => {
      // Arrange
      const userId = 'user-123';
      const contractType = 'loan_agreement';
      const recipient = { name: 'John Doe', email: 'john@example.com' };
      const { envelopeId } = await MockProvider.createEnvelope(userId, contractType, recipient);
      const expectedPort = process.env.PORT || 4000;

      // Act
      const result = await MockProvider.getSigningUrl(envelopeId, recipient);

      // Assert
      expect(result.signingUrl).toBe(
        `http://localhost:${expectedPort}/signing/mock/${envelopeId}?restart=true`
      );
    });

    it('should throw ENVELOPE_NOT_FOUND for unknown envelope', async () => {
      // Arrange
      const unknownId = 'non-existent-envelope-id';
      const recipient = { name: 'John Doe', email: 'john@example.com' };

      // Act & Assert
      await expect(MockProvider.getSigningUrl(unknownId, recipient)).rejects.toMatchObject({
        extensions: { code: ErrorCodes.ENVELOPE_NOT_FOUND },
      });
    });
  });

  describe('setEnvelopeStatus', () => {
    it('should update status for existing envelope', async () => {
      // Arrange
      const userId = 'user-123';
      const contractType = 'loan_agreement';
      const recipient = { name: 'John Doe', email: 'john@example.com' };
      const { envelopeId } = await MockProvider.createEnvelope(userId, contractType, recipient);

      // Act
      setEnvelopeStatus(envelopeId, 'completed');
      const status = await MockProvider.getEnvelopeStatus(envelopeId);

      // Assert
      expect(status).toBe('completed');
    });

    it('should not throw for unknown envelope (no-op)', () => {
      // Arrange
      const unknownId = 'non-existent-envelope-id';

      // Act & Assert - should not throw
      expect(() => setEnvelopeStatus(unknownId, 'completed')).not.toThrow();
    });

    it('should support all valid status transitions', async () => {
      // Arrange
      const userId = 'user-123';
      const contractType = 'loan_agreement';
      const recipient = { name: 'John Doe', email: 'john@example.com' };
      const { envelopeId } = await MockProvider.createEnvelope(userId, contractType, recipient);

      // Act & Assert - test each status
      setEnvelopeStatus(envelopeId, 'completed');
      expect(await MockProvider.getEnvelopeStatus(envelopeId)).toBe('completed');

      setEnvelopeStatus(envelopeId, 'voided');
      expect(await MockProvider.getEnvelopeStatus(envelopeId)).toBe('voided');

      setEnvelopeStatus(envelopeId, 'declined');
      expect(await MockProvider.getEnvelopeStatus(envelopeId)).toBe('declined');
    });
  });

  describe('clearEnvelopes', () => {
    it('should remove all envelopes', async () => {
      // Arrange
      const userId = 'user-123';
      const contractType = 'loan_agreement';
      const recipient = { name: 'John Doe', email: 'john@example.com' };
      const { envelopeId } = await MockProvider.createEnvelope(userId, contractType, recipient);

      // Act
      clearEnvelopes();

      // Assert
      await expect(MockProvider.getEnvelopeStatus(envelopeId)).rejects.toMatchObject({
        extensions: { code: ErrorCodes.ENVELOPE_NOT_FOUND },
      });
    });

    it('should allow creating new envelopes after clear', async () => {
      // Arrange
      const userId = 'user-123';
      const contractType = 'loan_agreement';
      const recipient = { name: 'John Doe', email: 'john@example.com' };
      await MockProvider.createEnvelope(userId, contractType, recipient);
      clearEnvelopes();

      // Act
      const result = await MockProvider.createEnvelope(userId, contractType, recipient);

      // Assert
      expect(result.envelopeId).toBeDefined();
      const status = await MockProvider.getEnvelopeStatus(result.envelopeId);
      expect(status).toBe('sent');
    });
  });

  describe('addEnvelope', () => {
    it('should default status, userId, and contractType when no options are given', async () => {
      // Act
      addEnvelope('envelope-with-defaults');

      // Assert
      const status = await MockProvider.getEnvelopeStatus('envelope-with-defaults');
      expect(status).toBe('sent');
    });

    it('should use provided status, userId, and contractType when given', async () => {
      // Act
      addEnvelope('envelope-with-overrides', {
        status: 'completed',
        userId: 'custom-user',
        contractType: 'nda',
      });

      // Assert
      const status = await MockProvider.getEnvelopeStatus('envelope-with-overrides');
      expect(status).toBe('completed');
    });
  });
});
