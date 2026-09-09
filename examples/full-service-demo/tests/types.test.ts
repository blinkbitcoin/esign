import { vi } from 'vitest';

import type {
  CreateEnvelopeInput,
  EnvelopeResult,
  EnvelopeStatus,
  ESignProvider,
  GraphQLContext,
  RecipientData,
} from '../src/types';

describe('Type Definitions', () => {
  describe('RecipientData', () => {
    it('should accept valid recipient data', () => {
      const recipient: RecipientData = {
        name: 'John Doe',
        email: 'john@example.com',
      };

      expect(recipient.name).toBe('John Doe');
      expect(recipient.email).toBe('john@example.com');
    });
  });

  describe('EnvelopeResult', () => {
    it('should accept valid envelope result', () => {
      const result: EnvelopeResult = {
        envelopeId: 'uuid-123',
        signingUrl: 'https://docusign.example.com/sign/123',
      };

      expect(result.envelopeId).toBe('uuid-123');
      expect(result.signingUrl).toContain('https://');
    });
  });

  describe('EnvelopeStatus', () => {
    it('should accept valid status values', () => {
      const statuses: EnvelopeStatus[] = ['sent', 'completed', 'voided', 'declined'];

      expect(statuses).toContain('sent');
      expect(statuses).toContain('completed');
      expect(statuses).toContain('voided');
      expect(statuses).toContain('declined');
    });
  });

  describe('CreateEnvelopeInput', () => {
    it('should accept valid create envelope input', () => {
      const input: CreateEnvelopeInput = {
        contractType: 'loan_agreement',
        recipient: {
          name: 'Jane Doe',
          email: 'jane@example.com',
        },
      };

      expect(input.contractType).toBe('loan_agreement');
      expect(input.recipient.name).toBe('Jane Doe');
    });
  });

  describe('GraphQLContext', () => {
    it('should accept context with userId', () => {
      const context: GraphQLContext = {
        userId: 'user-123',
      };

      expect(context.userId).toBe('user-123');
    });

    it('should accept context with null userId', () => {
      const context: GraphQLContext = {
        userId: null,
      };

      expect(context.userId).toBeNull();
    });
  });

  describe('ESignProvider interface', () => {
    it('should define mock provider matching interface', () => {
      // This test validates the interface structure at compile time
      const mockProvider: ESignProvider = {
        createEnvelope: vi.fn().mockResolvedValue({
          envelopeId: 'mock-id',
          signingUrl: 'https://mock.url',
        }),
        getEnvelopeStatus: vi.fn().mockResolvedValue('sent'),
      };

      expect(mockProvider.createEnvelope).toBeDefined();
      expect(mockProvider.getEnvelopeStatus).toBeDefined();
    });
  });
});
