// Tests for GraphQL schema and resolvers
// Mocks the envelope/audit repository modules to avoid a real Postgres connection

import { ApolloServer } from '@apollo/server';
import { vi } from 'vitest';

vi.mock('../src/envelope');
vi.mock('../src/audit');
// schema.ts's createEnvelope resolver only uses knex.transaction() to wrap
// calls to the (mocked) envelope/audit repository functions above - it never
// runs a real query against `trx`, so a trivial stub is enough here.
vi.mock('../src/db', () => ({
  knex: { transaction: (cb: (trx: unknown) => unknown) => cb({}) },
}));

import { getAuditLogsByEnvelopeId, logAuditEvent } from '../src/audit';
import { createEnvelope, getEnvelopeByIdForUser } from '../src/envelope';
import { ErrorCodes, Errors } from '../src/errors';
import { provider } from '../src/providers';
import { addEnvelope, clearEnvelopes } from '../src/providers/mock';
import { resolvers, typeDefs } from '../src/schema';

import type { GraphQLContext } from '../src/types';

const mockCreateEnvelope = vi.mocked(createEnvelope);
const mockGetEnvelopeByIdForUser = vi.mocked(getEnvelopeByIdForUser);
const mockLogAuditEvent = vi.mocked(logAuditEvent);
const mockGetAuditLogsByEnvelopeId = vi.mocked(getAuditLogsByEnvelopeId);

describe('GraphQL Schema', () => {
  let server: ApolloServer<GraphQLContext>;

  beforeAll(async () => {
    server = new ApolloServer<GraphQLContext>({ typeDefs, resolvers });
    await server.start();
  });

  afterAll(async () => {
    await server.stop();
  });

  beforeEach(() => {
    clearEnvelopes();
    vi.clearAllMocks();
    // Setup default mock behavior for envelope creation
    mockCreateEnvelope.mockImplementation(async (data) => ({
      id: 'mock-internal-uuid-' + Date.now() + '-' + Math.random().toString(36).slice(2),
      providerEnvelopeId: data.providerEnvelopeId,
      userId: data.userId,
      contractType: data.contractType,
      status: 'sent',
      createdAt: new Date(),
      updatedAt: new Date(),
    }));
    mockLogAuditEvent.mockResolvedValue(undefined);
  });

  describe('health query', () => {
    it('should return health status (regression test)', async () => {
      // Arrange
      const query = `
        query {
          health {
            status
            timestamp
          }
        }
      `;

      // Act
      const response = await server.executeOperation({ query }, { contextValue: { userId: null } });

      // Assert
      expect(response.body.kind).toBe('single');
      if (response.body.kind === 'single') {
        expect(response.body.singleResult.errors).toBeUndefined();
        const data = response.body.singleResult.data as {
          health: { status: string; timestamp: string };
        };
        expect(data.health.status).toBe('ok');
        expect(data.health.timestamp).toBeDefined();
      }
    });
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

    it('should return envelopeId and signingUrl with valid auth', async () => {
      // Arrange & Act
      const response = await server.executeOperation(
        { query: CREATE_ENVELOPE_MUTATION, variables: { input: validInput } },
        { contextValue: { userId: 'user-123' } }
      );

      // Assert
      expect(response.body.kind).toBe('single');
      if (response.body.kind === 'single') {
        expect(response.body.singleResult.errors).toBeUndefined();
        const data = response.body.singleResult.data as {
          createEnvelope: { envelopeId: string; signingUrl: string };
        };
        // envelopeId is our internal ID (not exposed to provider)
        expect(data.createEnvelope.envelopeId).toBeDefined();
        expect(data.createEnvelope.envelopeId).toContain('mock-internal-uuid-');
        // signingUrl contains provider's envelope ID (different from our internal ID)
        expect(data.createEnvelope.signingUrl).toContain('/signing/mock/');
        // Verify envelope was persisted to database
        expect(mockCreateEnvelope).toHaveBeenCalled();
        // Verify audit log was created
        expect(mockLogAuditEvent).toHaveBeenCalled();
      }
    });

    it('should return UNAUTHORIZED error without auth', async () => {
      // Arrange & Act
      const response = await server.executeOperation(
        { query: CREATE_ENVELOPE_MUTATION, variables: { input: validInput } },
        { contextValue: { userId: null } }
      );

      // Assert
      expect(response.body.kind).toBe('single');
      if (response.body.kind === 'single') {
        expect(response.body.singleResult.errors).toBeDefined();
        expect(response.body.singleResult.errors).toHaveLength(1);
        const error = response.body.singleResult.errors![0];
        expect(error.extensions?.code).toBe(ErrorCodes.UNAUTHORIZED);
      }
    });

    it('should call provider with correct parameters and persist envelope', async () => {
      // Arrange
      const userId = 'test-user-456';
      const input = {
        contractType: 'rental_agreement',
        recipient: { name: 'Jane Smith', email: 'jane@example.com' },
      };

      // Act
      const response = await server.executeOperation(
        { query: CREATE_ENVELOPE_MUTATION, variables: { input } },
        { contextValue: { userId } }
      );

      // Assert - Envelope is persisted with correct data
      expect(response.body.kind).toBe('single');
      if (response.body.kind === 'single') {
        expect(response.body.singleResult.errors).toBeUndefined();
        // Verify envelope was saved with correct fields
        expect(mockCreateEnvelope).toHaveBeenCalledWith(
          expect.objectContaining({
            userId: 'test-user-456',
            contractType: 'rental_agreement',
            // providerEnvelopeId is the provider's ID (not checked here, just exists)
            providerEnvelopeId: expect.any(String),
          }),
          expect.anything()
        );
        // Verify audit log was created
        expect(mockLogAuditEvent).toHaveBeenCalledWith(
          expect.any(String),
          'initiated',
          expect.objectContaining({
            contractType: 'rental_agreement',
            userId: 'test-user-456',
          }),
          expect.anything()
        );
      }
    });

    it('should create unique envelopes for each call', async () => {
      // Arrange & Act
      const response1 = await server.executeOperation(
        { query: CREATE_ENVELOPE_MUTATION, variables: { input: validInput } },
        { contextValue: { userId: 'user-1' } }
      );
      const response2 = await server.executeOperation(
        { query: CREATE_ENVELOPE_MUTATION, variables: { input: validInput } },
        { contextValue: { userId: 'user-2' } }
      );

      // Assert
      expect(response1.body.kind).toBe('single');
      expect(response2.body.kind).toBe('single');
      if (response1.body.kind === 'single' && response2.body.kind === 'single') {
        const data1 = response1.body.singleResult.data as {
          createEnvelope: { envelopeId: string };
        };
        const data2 = response2.body.singleResult.data as {
          createEnvelope: { envelopeId: string };
        };
        expect(data1.createEnvelope.envelopeId).not.toBe(data2.createEnvelope.envelopeId);
      }
    });

    it('should return signingUrl as valid URL with correct structure', async () => {
      // Arrange & Act
      const response = await server.executeOperation(
        { query: CREATE_ENVELOPE_MUTATION, variables: { input: validInput } },
        { contextValue: { userId: 'user-123' } }
      );

      // Assert
      expect(response.body.kind).toBe('single');
      if (response.body.kind === 'single') {
        const data = response.body.singleResult.data as {
          createEnvelope: { envelopeId: string; signingUrl: string };
        };
        // Verify URL is valid by parsing it
        const url = new URL(data.createEnvelope.signingUrl);
        expect(url.protocol).toBe('http:');
        expect(url.pathname).toContain('/signing/mock/');
        // signingUrl contains the provider's envelope ID (UUID format)
        expect(url.pathname).toMatch(/\/signing\/mock\/[0-9a-f-]{36}$/);
      }
    });

    it('should NEVER expose providerEnvelopeId in response (security critical)', async () => {
      // Arrange & Act
      const response = await server.executeOperation(
        { query: CREATE_ENVELOPE_MUTATION, variables: { input: validInput } },
        { contextValue: { userId: 'user-123' } }
      );

      // Assert
      expect(response.body.kind).toBe('single');
      if (response.body.kind === 'single') {
        expect(response.body.singleResult.errors).toBeUndefined();
        const data = response.body.singleResult.data as Record<string, unknown>;
        const envelope = data.createEnvelope as Record<string, unknown>;

        // CRITICAL: providerEnvelopeId must NEVER be in the response
        expect(envelope).not.toHaveProperty('providerEnvelopeId');
        expect(Object.keys(envelope)).toEqual(['envelopeId', 'signingUrl']);

        // Verify envelopeId is our internal ID (not the docusign ID)
        // Our internal ID starts with 'mock-internal-uuid-'
        expect(envelope.envelopeId).toContain('mock-internal-uuid-');
      }
    });

    describe('input validation', () => {
      it('should return VALIDATION_ERROR for empty contractType', async () => {
        // Arrange
        const invalidInput = {
          contractType: '',
          recipient: { name: 'John Doe', email: 'john@example.com' },
        };

        // Act
        const response = await server.executeOperation(
          { query: CREATE_ENVELOPE_MUTATION, variables: { input: invalidInput } },
          { contextValue: { userId: 'user-123' } }
        );

        // Assert
        expect(response.body.kind).toBe('single');
        if (response.body.kind === 'single') {
          expect(response.body.singleResult.errors).toBeDefined();
          expect(response.body.singleResult.errors).toHaveLength(1);
          const error = response.body.singleResult.errors![0];
          expect(error.extensions?.code).toBe(ErrorCodes.VALIDATION_ERROR);
          expect(error.message).toContain('contractType');
        }
      });

      it('should return VALIDATION_ERROR for whitespace-only contractType', async () => {
        // Arrange
        const invalidInput = {
          contractType: '   ',
          recipient: { name: 'John Doe', email: 'john@example.com' },
        };

        // Act
        const response = await server.executeOperation(
          { query: CREATE_ENVELOPE_MUTATION, variables: { input: invalidInput } },
          { contextValue: { userId: 'user-123' } }
        );

        // Assert
        expect(response.body.kind).toBe('single');
        if (response.body.kind === 'single') {
          expect(response.body.singleResult.errors).toBeDefined();
          const error = response.body.singleResult.errors![0];
          expect(error.extensions?.code).toBe(ErrorCodes.VALIDATION_ERROR);
        }
      });

      it('should return VALIDATION_ERROR for an over-length contractType', async () => {
        const invalidInput = {
          contractType: 'x'.repeat(101),
          recipient: { name: 'John Doe', email: 'john@example.com' },
        };

        const response = await server.executeOperation(
          { query: CREATE_ENVELOPE_MUTATION, variables: { input: invalidInput } },
          { contextValue: { userId: 'user-123' } }
        );

        expect(response.body.kind).toBe('single');
        if (response.body.kind === 'single') {
          const error = response.body.singleResult.errors![0];
          expect(error.extensions?.code).toBe(ErrorCodes.VALIDATION_ERROR);
          expect(error.message).toContain('contractType');
        }
      });

      it('should return VALIDATION_ERROR for an over-length recipient name', async () => {
        const invalidInput = {
          contractType: 'loan_agreement',
          recipient: { name: 'n'.repeat(201), email: 'john@example.com' },
        };

        const response = await server.executeOperation(
          { query: CREATE_ENVELOPE_MUTATION, variables: { input: invalidInput } },
          { contextValue: { userId: 'user-123' } }
        );

        expect(response.body.kind).toBe('single');
        if (response.body.kind === 'single') {
          const error = response.body.singleResult.errors![0];
          expect(error.extensions?.code).toBe(ErrorCodes.VALIDATION_ERROR);
          expect(error.message).toContain('recipient.name');
        }
      });

      it('should return VALIDATION_ERROR for empty recipient name', async () => {
        // Arrange
        const invalidInput = {
          contractType: 'loan_agreement',
          recipient: { name: '', email: 'john@example.com' },
        };

        // Act
        const response = await server.executeOperation(
          { query: CREATE_ENVELOPE_MUTATION, variables: { input: invalidInput } },
          { contextValue: { userId: 'user-123' } }
        );

        // Assert
        expect(response.body.kind).toBe('single');
        if (response.body.kind === 'single') {
          expect(response.body.singleResult.errors).toBeDefined();
          const error = response.body.singleResult.errors![0];
          expect(error.extensions?.code).toBe(ErrorCodes.VALIDATION_ERROR);
          expect(error.message).toContain('recipient.name');
        }
      });

      it('should return VALIDATION_ERROR for invalid email format', async () => {
        // Arrange
        const invalidInput = {
          contractType: 'loan_agreement',
          recipient: { name: 'John Doe', email: 'not-an-email' },
        };

        // Act
        const response = await server.executeOperation(
          { query: CREATE_ENVELOPE_MUTATION, variables: { input: invalidInput } },
          { contextValue: { userId: 'user-123' } }
        );

        // Assert
        expect(response.body.kind).toBe('single');
        if (response.body.kind === 'single') {
          expect(response.body.singleResult.errors).toBeDefined();
          const error = response.body.singleResult.errors![0];
          expect(error.extensions?.code).toBe(ErrorCodes.VALIDATION_ERROR);
          expect(error.message).toContain('email');
        }
      });

      it('should return VALIDATION_ERROR for email without domain', async () => {
        // Arrange
        const invalidInput = {
          contractType: 'loan_agreement',
          recipient: { name: 'John Doe', email: 'john@' },
        };

        // Act
        const response = await server.executeOperation(
          { query: CREATE_ENVELOPE_MUTATION, variables: { input: invalidInput } },
          { contextValue: { userId: 'user-123' } }
        );

        // Assert
        expect(response.body.kind).toBe('single');
        if (response.body.kind === 'single') {
          expect(response.body.singleResult.errors).toBeDefined();
          const error = response.body.singleResult.errors![0];
          expect(error.extensions?.code).toBe(ErrorCodes.VALIDATION_ERROR);
        }
      });
    });

    // Test failure logging
    describe('failure logging', () => {
      it('should log failure server-side when provider throws', async () => {
        // Arrange - mock provider to throw PROVIDER_UNAVAILABLE
        const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        const providerCreateSpy = vi
          .spyOn(provider, 'createEnvelope')
          .mockRejectedValue(Errors.providerUnavailable());

        // Act
        const response = await server.executeOperation(
          { query: CREATE_ENVELOPE_MUTATION, variables: { input: validInput } },
          { contextValue: { userId: 'user-123' } }
        );

        // Assert - error is returned to client
        expect(response.body.kind).toBe('single');
        if (response.body.kind === 'single') {
          expect(response.body.singleResult.errors).toBeDefined();
          const error = response.body.singleResult.errors![0];
          expect(error.extensions?.code).toBe(ErrorCodes.PROVIDER_UNAVAILABLE);
        }

        // Assert - failure was logged server-side
        expect(consoleErrorSpy).toHaveBeenCalledWith(
          'Envelope creation failed:',
          expect.objectContaining({
            action: 'creation_failed',
            errorCode: 'PROVIDER_UNAVAILABLE',
            contractType: 'loan_agreement',
            userId: 'user-123',
            timestamp: expect.any(String),
          })
        );

        // Cleanup
        consoleErrorSpy.mockRestore();
        providerCreateSpy.mockRestore();
      });

      it('should default to UNKNOWN_ERROR when the provider throws a non-object', async () => {
        // Arrange - provider rejects with a plain string, not a GraphQL error object
        const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        const providerCreateSpy = vi
          .spyOn(provider, 'createEnvelope')
          .mockRejectedValue('a raw string rejection');

        // Act
        await server.executeOperation(
          { query: CREATE_ENVELOPE_MUTATION, variables: { input: validInput } },
          { contextValue: { userId: 'user-123' } }
        );

        // Assert - errorCode falls back to UNKNOWN_ERROR
        expect(consoleErrorSpy).toHaveBeenCalledWith(
          'Envelope creation failed:',
          expect.objectContaining({ errorCode: 'UNKNOWN_ERROR' })
        );

        // Cleanup
        consoleErrorSpy.mockRestore();
        providerCreateSpy.mockRestore();
      });

      it('should read errorCode from a plain "code" property when "extensions.code" is absent', async () => {
        // Arrange - an error-like object with a top-level `code`, no `extensions`
        const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        const providerCreateSpy = vi
          .spyOn(provider, 'createEnvelope')
          .mockRejectedValue({ code: 'PROVIDER_TIMEOUT' });

        // Act
        await server.executeOperation(
          { query: CREATE_ENVELOPE_MUTATION, variables: { input: validInput } },
          { contextValue: { userId: 'user-123' } }
        );

        // Assert
        expect(consoleErrorSpy).toHaveBeenCalledWith(
          'Envelope creation failed:',
          expect.objectContaining({ errorCode: 'PROVIDER_TIMEOUT' })
        );

        // Cleanup
        consoleErrorSpy.mockRestore();
        providerCreateSpy.mockRestore();
      });

      it('should default to UNKNOWN_ERROR for an object error with no code or extensions.code', async () => {
        // Arrange - an object that's neither a GraphQL error nor a plain
        // { code } shape, e.g. an unexpected object thrown by a dependency
        const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        const providerCreateSpy = vi
          .spyOn(provider, 'createEnvelope')
          .mockRejectedValue({ reason: 'something unexpected' });

        // Act
        await server.executeOperation(
          { query: CREATE_ENVELOPE_MUTATION, variables: { input: validInput } },
          { contextValue: { userId: 'user-123' } }
        );

        // Assert
        expect(consoleErrorSpy).toHaveBeenCalledWith(
          'Envelope creation failed:',
          expect.objectContaining({ errorCode: 'UNKNOWN_ERROR' })
        );

        // Cleanup
        consoleErrorSpy.mockRestore();
        providerCreateSpy.mockRestore();
      });

      it('should NOT include PII in failure logs', async () => {
        // Arrange - mock provider to throw
        const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        const providerCreateSpy = vi
          .spyOn(provider, 'createEnvelope')
          .mockRejectedValue(Errors.providerUnavailable());

        // Act
        await server.executeOperation(
          { query: CREATE_ENVELOPE_MUTATION, variables: { input: validInput } },
          { contextValue: { userId: 'user-123' } }
        );

        // Assert - logged metadata does NOT contain PII
        expect(consoleErrorSpy).toHaveBeenCalled();
        const loggedData = consoleErrorSpy.mock.calls[0][1] as Record<string, unknown>;

        // CRITICAL: No PII in logs
        expect(loggedData).not.toHaveProperty('email');
        expect(loggedData).not.toHaveProperty('name');
        expect(loggedData).not.toHaveProperty('recipient');
        expect(Object.keys(loggedData).sort()).toEqual([
          'action',
          'contractType',
          'errorCode',
          'timestamp',
          'userId',
        ]);

        // Cleanup
        consoleErrorSpy.mockRestore();
        providerCreateSpy.mockRestore();
      });

      it('should return PERSISTENCE_FAILED and log when the DB transaction fails', async () => {
        // Arrange - provider succeeds, but persisting the envelope fails
        const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        mockCreateEnvelope.mockRejectedValue(new Error('connection terminated'));

        // Act
        const response = await server.executeOperation(
          { query: CREATE_ENVELOPE_MUTATION, variables: { input: validInput } },
          { contextValue: { userId: 'user-123' } }
        );

        // Assert - client gets a generic persistence error (no internals leaked)
        expect(response.body.kind).toBe('single');
        if (response.body.kind === 'single') {
          expect(response.body.singleResult.errors).toBeDefined();
          const error = response.body.singleResult.errors![0];
          expect(error.extensions?.code).toBe(ErrorCodes.PERSISTENCE_FAILED);
        }

        // Assert - failure was logged server-side with the underlying message
        expect(consoleErrorSpy).toHaveBeenCalledWith(
          'Failed to persist envelope:',
          'connection terminated'
        );

        // Cleanup
        consoleErrorSpy.mockRestore();
      });

      it('should log the raw value when the DB transaction rejects with a non-Error', async () => {
        // Arrange
        const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        mockCreateEnvelope.mockRejectedValue('raw persistence failure');

        // Act
        const response = await server.executeOperation(
          { query: CREATE_ENVELOPE_MUTATION, variables: { input: validInput } },
          { contextValue: { userId: 'user-123' } }
        );

        // Assert
        expect(response.body.kind).toBe('single');
        if (response.body.kind === 'single') {
          const error = response.body.singleResult.errors![0];
          expect(error.extensions?.code).toBe(ErrorCodes.PERSISTENCE_FAILED);
        }
        expect(consoleErrorSpy).toHaveBeenCalledWith(
          'Failed to persist envelope:',
          'raw persistence failure'
        );

        // Cleanup
        consoleErrorSpy.mockRestore();
      });
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

    const mockEnvelope = {
      id: 'uuid-123',
      providerEnvelopeId: 'docusign-secret-id',
      userId: 'user-123',
      contractType: 'loan_agreement',
      status: 'sent',
      createdAt: new Date('2026-02-01T12:00:00.000Z'),
      updatedAt: new Date('2026-02-01T12:00:00.000Z'),
    };

    it('should return envelope for authenticated user', async () => {
      // Arrange
      mockGetEnvelopeByIdForUser.mockResolvedValue(mockEnvelope);

      // Act
      const response = await server.executeOperation(
        { query: ENVELOPE_QUERY, variables: { id: 'uuid-123' } },
        { contextValue: { userId: 'user-123' } }
      );

      // Assert
      expect(response.body.kind).toBe('single');
      if (response.body.kind === 'single') {
        expect(response.body.singleResult.errors).toBeUndefined();
        const data = response.body.singleResult.data as {
          envelope: { id: string; status: string; contractType: string; createdAt: string };
        };
        expect(data.envelope.id).toBe('uuid-123');
        expect(data.envelope.status).toBe('sent');
        expect(data.envelope.contractType).toBe('loan_agreement');
        expect(data.envelope.createdAt).toBe('2026-02-01T12:00:00.000Z');
      }
    });

    it('should return ENVELOPE_NOT_FOUND for non-existent envelope', async () => {
      // Arrange
      mockGetEnvelopeByIdForUser.mockResolvedValue(null);

      // Act
      const response = await server.executeOperation(
        { query: ENVELOPE_QUERY, variables: { id: 'non-existent-id' } },
        { contextValue: { userId: 'user-123' } }
      );

      // Assert
      expect(response.body.kind).toBe('single');
      if (response.body.kind === 'single') {
        expect(response.body.singleResult.errors).toBeDefined();
        expect(response.body.singleResult.errors).toHaveLength(1);
        const error = response.body.singleResult.errors![0];
        expect(error.extensions?.code).toBe(ErrorCodes.ENVELOPE_NOT_FOUND);
      }
    });

    it('should return ENVELOPE_NOT_FOUND for other user envelope (no info leak)', async () => {
      // Arrange - envelope exists but belongs to different user
      // The getEnvelopeByIdForUser returns null when user doesn't match
      mockGetEnvelopeByIdForUser.mockResolvedValue(null);

      // Act
      const response = await server.executeOperation(
        { query: ENVELOPE_QUERY, variables: { id: 'uuid-123' } },
        { contextValue: { userId: 'different-user' } }
      );

      // Assert - should NOT reveal that envelope exists
      expect(response.body.kind).toBe('single');
      if (response.body.kind === 'single') {
        expect(response.body.singleResult.errors).toBeDefined();
        const error = response.body.singleResult.errors![0];
        expect(error.extensions?.code).toBe(ErrorCodes.ENVELOPE_NOT_FOUND);
        // Error message should be generic - not reveal envelope exists
        expect(error.message).not.toContain('another user');
        expect(error.message).not.toContain('unauthorized');
      }
    });

    it('should return UNAUTHORIZED for unauthenticated request', async () => {
      // Act
      const response = await server.executeOperation(
        { query: ENVELOPE_QUERY, variables: { id: 'uuid-123' } },
        { contextValue: { userId: null } }
      );

      // Assert
      expect(response.body.kind).toBe('single');
      if (response.body.kind === 'single') {
        expect(response.body.singleResult.errors).toBeDefined();
        expect(response.body.singleResult.errors).toHaveLength(1);
        const error = response.body.singleResult.errors![0];
        expect(error.extensions?.code).toBe(ErrorCodes.UNAUTHORIZED);
      }
    });

    it('should NEVER expose providerEnvelopeId in response (security critical)', async () => {
      // Arrange
      mockGetEnvelopeByIdForUser.mockResolvedValue(mockEnvelope);

      // Act
      const response = await server.executeOperation(
        { query: ENVELOPE_QUERY, variables: { id: 'uuid-123' } },
        { contextValue: { userId: 'user-123' } }
      );

      // Assert
      expect(response.body.kind).toBe('single');
      if (response.body.kind === 'single') {
        expect(response.body.singleResult.errors).toBeUndefined();
        const data = response.body.singleResult.data as Record<string, unknown>;
        const envelope = data.envelope as Record<string, unknown>;

        // CRITICAL: providerEnvelopeId must NEVER be in the response
        expect(envelope).not.toHaveProperty('providerEnvelopeId');
        expect(Object.keys(envelope).sort()).toEqual(['contractType', 'createdAt', 'id', 'status']);

        // Verify we're returning internal ID, not docusign ID
        expect(envelope.id).toBe('uuid-123');
        expect(envelope.id).not.toBe('docusign-secret-id');
      }
    });

    it('should return completed status when envelope is completed', async () => {
      // Arrange
      const completedEnvelope = { ...mockEnvelope, status: 'completed' };
      mockGetEnvelopeByIdForUser.mockResolvedValue(completedEnvelope);

      // Act
      const response = await server.executeOperation(
        { query: ENVELOPE_QUERY, variables: { id: 'uuid-123' } },
        { contextValue: { userId: 'user-123' } }
      );

      // Assert
      expect(response.body.kind).toBe('single');
      if (response.body.kind === 'single') {
        expect(response.body.singleResult.errors).toBeUndefined();
        const data = response.body.singleResult.data as {
          envelope: { status: string };
        };
        expect(data.envelope.status).toBe('completed');
      }
    });

    it('should return VALIDATION_ERROR for empty id', async () => {
      // Act
      const response = await server.executeOperation(
        { query: ENVELOPE_QUERY, variables: { id: '' } },
        { contextValue: { userId: 'user-123' } }
      );

      // Assert
      expect(response.body.kind).toBe('single');
      if (response.body.kind === 'single') {
        expect(response.body.singleResult.errors).toBeDefined();
        expect(response.body.singleResult.errors).toHaveLength(1);
        const error = response.body.singleResult.errors![0];
        expect(error.extensions?.code).toBe(ErrorCodes.VALIDATION_ERROR);
        expect(error.message).toContain('id');
      }
    });

    it('should return VALIDATION_ERROR for whitespace-only id', async () => {
      // Act
      const response = await server.executeOperation(
        { query: ENVELOPE_QUERY, variables: { id: '   ' } },
        { contextValue: { userId: 'user-123' } }
      );

      // Assert
      expect(response.body.kind).toBe('single');
      if (response.body.kind === 'single') {
        expect(response.body.singleResult.errors).toBeDefined();
        const error = response.body.singleResult.errors![0];
        expect(error.extensions?.code).toBe(ErrorCodes.VALIDATION_ERROR);
      }
    });
  });

  // getSigningUrl mutation tests
  describe('getSigningUrl mutation', () => {
    const GET_SIGNING_URL_MUTATION = `
      mutation GetSigningUrl($input: GetSigningUrlInput!) {
        getSigningUrl(input: $input) {
          signingUrl
        }
      }
    `;

    const mockEnvelope = {
      id: 'uuid-123',
      providerEnvelopeId: 'docusign-envelope-id',
      userId: 'user-123',
      contractType: 'loan_agreement',
      status: 'sent',
      createdAt: new Date('2026-02-01T12:00:00.000Z'),
      updatedAt: new Date('2026-02-01T12:00:00.000Z'),
    };

    const validInput = {
      envelopeId: 'uuid-123',
      recipient: { name: 'John Doe', email: 'john@example.com' },
    };

    it('should return new signingUrl for valid request', async () => {
      // Arrange
      mockGetEnvelopeByIdForUser.mockResolvedValue(mockEnvelope);
      // Add envelope to MockProvider so provider.getSigningUrl works
      addEnvelope(mockEnvelope.providerEnvelopeId, { status: 'sent', userId: 'user-123' });

      // Act
      const response = await server.executeOperation(
        { query: GET_SIGNING_URL_MUTATION, variables: { input: validInput } },
        { contextValue: { userId: 'user-123' } }
      );

      // Assert
      expect(response.body.kind).toBe('single');
      if (response.body.kind === 'single') {
        expect(response.body.singleResult.errors).toBeUndefined();
        const data = response.body.singleResult.data as {
          getSigningUrl: { signingUrl: string };
        };
        expect(data.getSigningUrl.signingUrl).toBeDefined();
        expect(data.getSigningUrl.signingUrl).toContain('/signing/mock/');
        // Verify audit log was created for session restart
        expect(mockLogAuditEvent).toHaveBeenCalledWith(
          'uuid-123',
          'session_restart',
          expect.anything()
        );
      }
    });

    it('should return UNAUTHORIZED without auth', async () => {
      // Arrange
      mockGetEnvelopeByIdForUser.mockResolvedValue(mockEnvelope);

      // Act
      const response = await server.executeOperation(
        { query: GET_SIGNING_URL_MUTATION, variables: { input: validInput } },
        { contextValue: { userId: null } }
      );

      // Assert
      expect(response.body.kind).toBe('single');
      if (response.body.kind === 'single') {
        expect(response.body.singleResult.errors).toBeDefined();
        const error = response.body.singleResult.errors![0];
        expect(error.extensions?.code).toBe(ErrorCodes.UNAUTHORIZED);
      }
    });

    it('should return VALIDATION_ERROR for an over-length recipient name', async () => {
      const response = await server.executeOperation(
        {
          query: GET_SIGNING_URL_MUTATION,
          variables: {
            input: {
              envelopeId: 'uuid-123',
              recipient: { name: 'n'.repeat(201), email: 'john@example.com' },
            },
          },
        },
        { contextValue: { userId: 'user-123' } }
      );

      expect(response.body.kind).toBe('single');
      if (response.body.kind === 'single') {
        const error = response.body.singleResult.errors![0];
        expect(error.extensions?.code).toBe(ErrorCodes.VALIDATION_ERROR);
        expect(error.message).toContain('recipient.name');
      }
    });

    it('should return ENVELOPE_NOT_FOUND for non-existent envelope', async () => {
      // Arrange
      mockGetEnvelopeByIdForUser.mockResolvedValue(null);

      // Act
      const response = await server.executeOperation(
        { query: GET_SIGNING_URL_MUTATION, variables: { input: validInput } },
        { contextValue: { userId: 'user-123' } }
      );

      // Assert
      expect(response.body.kind).toBe('single');
      if (response.body.kind === 'single') {
        expect(response.body.singleResult.errors).toBeDefined();
        const error = response.body.singleResult.errors![0];
        expect(error.extensions?.code).toBe(ErrorCodes.ENVELOPE_NOT_FOUND);
      }
    });

    it('should return ENVELOPE_NOT_FOUND for other user envelope (ownership check)', async () => {
      // Arrange - envelope exists but user doesn't own it
      mockGetEnvelopeByIdForUser.mockResolvedValue(null);

      // Act
      const response = await server.executeOperation(
        { query: GET_SIGNING_URL_MUTATION, variables: { input: validInput } },
        { contextValue: { userId: 'different-user' } }
      );

      // Assert - should NOT reveal that envelope exists
      expect(response.body.kind).toBe('single');
      if (response.body.kind === 'single') {
        expect(response.body.singleResult.errors).toBeDefined();
        const error = response.body.singleResult.errors![0];
        expect(error.extensions?.code).toBe(ErrorCodes.ENVELOPE_NOT_FOUND);
      }
    });

    it('should return VALIDATION_ERROR for completed envelope', async () => {
      // Arrange - envelope is already completed
      const completedEnvelope = { ...mockEnvelope, status: 'completed' };
      mockGetEnvelopeByIdForUser.mockResolvedValue(completedEnvelope);
      // Add envelope to MockProvider (not strictly needed since validation happens before provider call)
      addEnvelope(mockEnvelope.providerEnvelopeId, { status: 'completed', userId: 'user-123' });

      // Act
      const response = await server.executeOperation(
        { query: GET_SIGNING_URL_MUTATION, variables: { input: validInput } },
        { contextValue: { userId: 'user-123' } }
      );

      // Assert
      expect(response.body.kind).toBe('single');
      if (response.body.kind === 'single') {
        expect(response.body.singleResult.errors).toBeDefined();
        const error = response.body.singleResult.errors![0];
        expect(error.extensions?.code).toBe(ErrorCodes.VALIDATION_ERROR);
        expect(error.message).toContain('Cannot restart');
      }
    });

    it('should return VALIDATION_ERROR for empty envelopeId', async () => {
      // Act
      const response = await server.executeOperation(
        {
          query: GET_SIGNING_URL_MUTATION,
          variables: { input: { envelopeId: '', recipient: validInput.recipient } },
        },
        { contextValue: { userId: 'user-123' } }
      );

      // Assert
      expect(response.body.kind).toBe('single');
      if (response.body.kind === 'single') {
        expect(response.body.singleResult.errors).toBeDefined();
        const error = response.body.singleResult.errors![0];
        expect(error.extensions?.code).toBe(ErrorCodes.VALIDATION_ERROR);
        expect(error.message).toContain('envelopeId');
      }
    });

    it('should return VALIDATION_ERROR for empty recipient name', async () => {
      // Act
      const response = await server.executeOperation(
        {
          query: GET_SIGNING_URL_MUTATION,
          variables: {
            input: { envelopeId: 'uuid-123', recipient: { name: '', email: 'john@example.com' } },
          },
        },
        { contextValue: { userId: 'user-123' } }
      );

      // Assert
      expect(response.body.kind).toBe('single');
      if (response.body.kind === 'single') {
        expect(response.body.singleResult.errors).toBeDefined();
        const error = response.body.singleResult.errors![0];
        expect(error.extensions?.code).toBe(ErrorCodes.VALIDATION_ERROR);
        expect(error.message).toContain('recipient.name');
      }
    });

    it('should return VALIDATION_ERROR for invalid email', async () => {
      // Act
      const response = await server.executeOperation(
        {
          query: GET_SIGNING_URL_MUTATION,
          variables: {
            input: { envelopeId: 'uuid-123', recipient: { name: 'John', email: 'invalid' } },
          },
        },
        { contextValue: { userId: 'user-123' } }
      );

      // Assert
      expect(response.body.kind).toBe('single');
      if (response.body.kind === 'single') {
        expect(response.body.singleResult.errors).toBeDefined();
        const error = response.body.singleResult.errors![0];
        expect(error.extensions?.code).toBe(ErrorCodes.VALIDATION_ERROR);
        expect(error.message).toContain('email');
      }
    });
  });

  // auditLogs query tests
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

    const mockEnvelope = {
      id: 'uuid-123',
      providerEnvelopeId: 'docusign-secret-id',
      userId: 'user-123',
      contractType: 'loan_agreement',
      status: 'sent',
      createdAt: new Date('2026-02-01T12:00:00.000Z'),
      updatedAt: new Date('2026-02-01T12:00:00.000Z'),
    };

    const mockAuditLogs = [
      {
        id: 'log-3',
        envelopeId: 'uuid-123',
        action: 'completed',
        timestamp: new Date('2026-02-01T14:00:00.000Z'),
        metadata: { source: 'webhook' },
      },
      {
        id: 'log-2',
        envelopeId: 'uuid-123',
        action: 'session_restart',
        timestamp: new Date('2026-02-01T13:00:00.000Z'),
        metadata: { userId: 'user-123' },
      },
      {
        id: 'log-1',
        envelopeId: 'uuid-123',
        action: 'initiated',
        timestamp: new Date('2026-02-01T12:00:00.000Z'),
        metadata: { contractType: 'loan_agreement', userId: 'user-123' },
      },
    ];

    it('should return audit logs for owned envelope', async () => {
      // Arrange
      mockGetEnvelopeByIdForUser.mockResolvedValue(mockEnvelope);
      mockGetAuditLogsByEnvelopeId.mockResolvedValue(mockAuditLogs);

      // Act
      const response = await server.executeOperation(
        { query: AUDIT_LOGS_QUERY, variables: { envelopeId: 'uuid-123' } },
        { contextValue: { userId: 'user-123' } }
      );

      // Assert
      expect(response.body.kind).toBe('single');
      if (response.body.kind === 'single') {
        expect(response.body.singleResult.errors).toBeUndefined();
        const data = response.body.singleResult.data as {
          auditLogs: { id: string; action: string; timestamp: string; metadata: string | null }[];
        };
        expect(data.auditLogs).toHaveLength(3);
        // Verify order: most recent first (timestamp desc)
        expect(data.auditLogs[0].action).toBe('completed');
        expect(data.auditLogs[1].action).toBe('session_restart');
        expect(data.auditLogs[2].action).toBe('initiated');
        // Verify timestamps are ISO strings
        expect(data.auditLogs[0].timestamp).toBe('2026-02-01T14:00:00.000Z');
        // Verify metadata is serialized JSON
        expect(JSON.parse(data.auditLogs[0].metadata!)).toEqual({ source: 'webhook' });
      }
    });

    it('should return empty array for envelope with no logs', async () => {
      // Arrange
      mockGetEnvelopeByIdForUser.mockResolvedValue(mockEnvelope);
      mockGetAuditLogsByEnvelopeId.mockResolvedValue([]);

      // Act
      const response = await server.executeOperation(
        { query: AUDIT_LOGS_QUERY, variables: { envelopeId: 'uuid-123' } },
        { contextValue: { userId: 'user-123' } }
      );

      // Assert
      expect(response.body.kind).toBe('single');
      if (response.body.kind === 'single') {
        expect(response.body.singleResult.errors).toBeUndefined();
        const data = response.body.singleResult.data as {
          auditLogs: unknown[];
        };
        expect(data.auditLogs).toEqual([]);
      }
    });

    it('should return ENVELOPE_NOT_FOUND for non-existent envelope', async () => {
      // Arrange
      mockGetEnvelopeByIdForUser.mockResolvedValue(null);

      // Act
      const response = await server.executeOperation(
        { query: AUDIT_LOGS_QUERY, variables: { envelopeId: 'non-existent' } },
        { contextValue: { userId: 'user-123' } }
      );

      // Assert
      expect(response.body.kind).toBe('single');
      if (response.body.kind === 'single') {
        expect(response.body.singleResult.errors).toBeDefined();
        expect(response.body.singleResult.errors).toHaveLength(1);
        const error = response.body.singleResult.errors![0];
        expect(error.extensions?.code).toBe(ErrorCodes.ENVELOPE_NOT_FOUND);
      }
    });

    it('should return ENVELOPE_NOT_FOUND for other user envelope (ownership check)', async () => {
      // Arrange - envelope exists but user doesn't own it
      mockGetEnvelopeByIdForUser.mockResolvedValue(null);

      // Act
      const response = await server.executeOperation(
        { query: AUDIT_LOGS_QUERY, variables: { envelopeId: 'uuid-123' } },
        { contextValue: { userId: 'different-user' } }
      );

      // Assert - should NOT reveal that envelope exists
      expect(response.body.kind).toBe('single');
      if (response.body.kind === 'single') {
        expect(response.body.singleResult.errors).toBeDefined();
        const error = response.body.singleResult.errors![0];
        expect(error.extensions?.code).toBe(ErrorCodes.ENVELOPE_NOT_FOUND);
      }
    });

    it('should return UNAUTHORIZED without auth', async () => {
      // Act
      const response = await server.executeOperation(
        { query: AUDIT_LOGS_QUERY, variables: { envelopeId: 'uuid-123' } },
        { contextValue: { userId: null } }
      );

      // Assert
      expect(response.body.kind).toBe('single');
      if (response.body.kind === 'single') {
        expect(response.body.singleResult.errors).toBeDefined();
        expect(response.body.singleResult.errors).toHaveLength(1);
        const error = response.body.singleResult.errors![0];
        expect(error.extensions?.code).toBe(ErrorCodes.UNAUTHORIZED);
      }
    });

    it('should return VALIDATION_ERROR for empty envelopeId', async () => {
      // Act
      const response = await server.executeOperation(
        { query: AUDIT_LOGS_QUERY, variables: { envelopeId: '' } },
        { contextValue: { userId: 'user-123' } }
      );

      // Assert
      expect(response.body.kind).toBe('single');
      if (response.body.kind === 'single') {
        expect(response.body.singleResult.errors).toBeDefined();
        expect(response.body.singleResult.errors).toHaveLength(1);
        const error = response.body.singleResult.errors![0];
        expect(error.extensions?.code).toBe(ErrorCodes.VALIDATION_ERROR);
        expect(error.message).toContain('envelopeId');
      }
    });

    it('should return VALIDATION_ERROR for whitespace-only envelopeId', async () => {
      // Act
      const response = await server.executeOperation(
        { query: AUDIT_LOGS_QUERY, variables: { envelopeId: '   ' } },
        { contextValue: { userId: 'user-123' } }
      );

      // Assert
      expect(response.body.kind).toBe('single');
      if (response.body.kind === 'single') {
        expect(response.body.singleResult.errors).toBeDefined();
        const error = response.body.singleResult.errors![0];
        expect(error.extensions?.code).toBe(ErrorCodes.VALIDATION_ERROR);
      }
    });

    it('should handle null metadata in audit logs', async () => {
      // Arrange
      const logsWithNullMetadata = [
        {
          id: 'log-1',
          envelopeId: 'uuid-123',
          action: 'failed',
          timestamp: new Date('2026-02-01T12:00:00.000Z'),
          metadata: null,
        },
      ];
      mockGetEnvelopeByIdForUser.mockResolvedValue(mockEnvelope);
      mockGetAuditLogsByEnvelopeId.mockResolvedValue(logsWithNullMetadata);

      // Act
      const response = await server.executeOperation(
        { query: AUDIT_LOGS_QUERY, variables: { envelopeId: 'uuid-123' } },
        { contextValue: { userId: 'user-123' } }
      );

      // Assert
      expect(response.body.kind).toBe('single');
      if (response.body.kind === 'single') {
        expect(response.body.singleResult.errors).toBeUndefined();
        const data = response.body.singleResult.data as {
          auditLogs: { id: string; metadata: string | null }[];
        };
        expect(data.auditLogs[0].metadata).toBeNull();
      }
    });
  });
});
