// Tests for GraphQL schema and resolvers
// Runs the real envelope domain (@blinkbitcoin/esign-node) over an in-memory
// store, so no Postgres connection is needed and behaviour is asserted on the
// resulting state rather than on mocked repository calls.

import { randomUUID } from 'node:crypto';
import { ApolloServer } from '@apollo/server';
import { vi } from 'vitest';

vi.mock('../src/store', async () => {
  const { createMemoryEnvelopeStore } = await import('@blinkbitcoin/esign-node');
  return { store: createMemoryEnvelopeStore(), createKnexEnvelopeStore: vi.fn() };
});

import type { EnvelopeStatus } from '@blinkbitcoin/esign-node';
import { ErrorCodes, Errors } from '../src/errors';
import { createMock } from '../src/providers/mock';
import { createGraphQL } from '../src/schema';
import { createServices } from '../src/services';
import { store } from '../src/store';

// The service composes these per app; a test composes its own over the
// in-memory store mocked above, so the resolvers run on the very provider
// this file drives
const provider = createMock();
const { addEnvelope, clearEnvelopes } = provider;
const { resolvers, typeDefs } = createGraphQL(createServices(provider));

import type { GraphQLContext } from '../src/types';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// Seed a persisted envelope (ids are unique per test: the memory store is
// shared across the file and is never cleared)
const seedEnvelope = async (overrides: { status?: EnvelopeStatus; userId?: string } = {}) => {
  const id = randomUUID();
  const providerEnvelopeId = `docusign-secret-${randomUUID()}`;
  const record = await store.createEnvelope({
    id,
    providerEnvelopeId,
    userId: overrides.userId ?? 'user-123',
    contractType: 'loan_agreement',
    status: overrides.status ?? 'sent',
  });
  return record;
};

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
        // envelopeId is our internal ID (not the provider's)
        expect(data.createEnvelope.envelopeId).toMatch(UUID_RE);
        // signingUrl contains provider's envelope ID (different from our internal ID)
        expect(data.createEnvelope.signingUrl).toContain('/signing/mock/');
        expect(data.createEnvelope.signingUrl).not.toContain(data.createEnvelope.envelopeId);
        // Verify envelope was persisted to the store
        const persisted = await store.getEnvelopeById(data.createEnvelope.envelopeId);
        expect(persisted).not.toBeNull();
        expect(persisted!.status).toBe('sent');
        // Verify audit log was created
        const audit = await store.listAuditEntries(data.createEnvelope.envelopeId);
        expect(audit).toHaveLength(1);
        expect(audit[0].action).toBe('initiated');
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
        const data = response.body.singleResult.data as {
          createEnvelope: { envelopeId: string; signingUrl: string };
        };
        // Verify envelope was saved with correct fields, including the
        // provider's id (the one the signing URL points at)
        const persisted = await store.getEnvelopeById(data.createEnvelope.envelopeId);
        expect(persisted).toMatchObject({
          userId: 'test-user-456',
          contractType: 'rental_agreement',
          status: 'sent',
          providerEnvelopeId: expect.any(String),
        });
        expect(data.createEnvelope.signingUrl).toContain(persisted!.providerEnvelopeId);
        // Verify audit log was created with sanitized (PII-free) metadata
        const audit = await store.listAuditEntries(data.createEnvelope.envelopeId);
        expect(audit).toHaveLength(1);
        expect(audit[0].action).toBe('initiated');
        expect(audit[0].metadata).toEqual({
          contractType: 'rental_agreement',
          userId: 'test-user-456',
        });
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
        // Each is owned by its creator
        expect((await store.getEnvelopeById(data1.createEnvelope.envelopeId))!.userId).toBe(
          'user-1'
        );
        expect((await store.getEnvelopeById(data2.createEnvelope.envelopeId))!.userId).toBe(
          'user-2'
        );
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

        // Verify envelopeId is our internal ID, not the provider's
        const persisted = await store.getEnvelopeById(envelope.envelopeId as string);
        expect(persisted).not.toBeNull();
        expect(envelope.envelopeId).not.toBe(persisted!.providerEnvelopeId);
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
        // Arrange - provider rejects with a plain string, not a coded error object
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
        // Arrange - an object that's neither a coded error nor a plain
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
        // Call-through spy so we learn the provider id the envelope would have had
        const providerCreateSpy = vi.spyOn(provider, 'createEnvelope');
        const transactionSpy = vi
          .spyOn(store, 'transaction')
          .mockRejectedValueOnce(new Error('connection terminated'));

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
          expect(error.message).not.toContain('connection terminated');
        }

        // Assert - failure was logged server-side with the underlying message
        expect(consoleErrorSpy).toHaveBeenCalledWith(
          'Failed to persist envelope:',
          'connection terminated'
        );

        // Assert - nothing was persisted for the provider envelope
        const { envelopeId: providerEnvelopeId } = await providerCreateSpy.mock.results[0].value;
        expect(await store.getEnvelopeByProviderEnvelopeId(providerEnvelopeId)).toBeNull();

        // Cleanup
        consoleErrorSpy.mockRestore();
        providerCreateSpy.mockRestore();
        transactionSpy.mockRestore();
      });

      it('should log the raw value when the DB transaction rejects with a non-Error', async () => {
        // Arrange
        const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        const transactionSpy = vi
          .spyOn(store, 'transaction')
          .mockRejectedValueOnce('raw persistence failure');

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
        transactionSpy.mockRestore();
      });

      it('should roll back the envelope when the audit entry cannot be written', async () => {
        // Arrange - the envelope insert succeeds inside the transaction but the
        // audit write fails; the memory store restores its snapshot on throw
        const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        const providerCreateSpy = vi.spyOn(provider, 'createEnvelope');
        const appendSpy = vi
          .spyOn(store, 'appendAuditEntry')
          .mockRejectedValueOnce(new Error('audit insert failed'));

        // Act
        const response = await server.executeOperation(
          { query: CREATE_ENVELOPE_MUTATION, variables: { input: validInput } },
          { contextValue: { userId: 'user-123' } }
        );

        // Assert - atomic: no envelope without its audit entry
        expect(response.body.kind).toBe('single');
        if (response.body.kind === 'single') {
          const error = response.body.singleResult.errors![0];
          expect(error.extensions?.code).toBe(ErrorCodes.PERSISTENCE_FAILED);
        }
        const { envelopeId: providerEnvelopeId } = await providerCreateSpy.mock.results[0].value;
        expect(await store.getEnvelopeByProviderEnvelopeId(providerEnvelopeId)).toBeNull();

        // Cleanup
        consoleErrorSpy.mockRestore();
        providerCreateSpy.mockRestore();
        appendSpy.mockRestore();
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

    it('should return envelope for authenticated user', async () => {
      // Arrange
      const seeded = await seedEnvelope();

      // Act
      const response = await server.executeOperation(
        { query: ENVELOPE_QUERY, variables: { id: seeded.id } },
        { contextValue: { userId: 'user-123' } }
      );

      // Assert
      expect(response.body.kind).toBe('single');
      if (response.body.kind === 'single') {
        expect(response.body.singleResult.errors).toBeUndefined();
        const data = response.body.singleResult.data as {
          envelope: { id: string; status: string; contractType: string; createdAt: string };
        };
        expect(data.envelope.id).toBe(seeded.id);
        expect(data.envelope.status).toBe('sent');
        expect(data.envelope.contractType).toBe('loan_agreement');
        expect(data.envelope.createdAt).toBe(seeded.createdAt.toISOString());
      }
    });

    it('should return ENVELOPE_NOT_FOUND for non-existent envelope', async () => {
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
      const seeded = await seedEnvelope({ userId: 'user-123' });

      // Act
      const response = await server.executeOperation(
        { query: ENVELOPE_QUERY, variables: { id: seeded.id } },
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
      // Arrange
      const seeded = await seedEnvelope();

      // Act
      const response = await server.executeOperation(
        { query: ENVELOPE_QUERY, variables: { id: seeded.id } },
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
      const seeded = await seedEnvelope();

      // Act
      const response = await server.executeOperation(
        { query: ENVELOPE_QUERY, variables: { id: seeded.id } },
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

        // Verify we're returning internal ID, not the provider's ID
        expect(envelope.id).toBe(seeded.id);
        expect(envelope.id).not.toBe(seeded.providerEnvelopeId);
        expect(JSON.stringify(data)).not.toContain(seeded.providerEnvelopeId);
      }
    });

    it('should return completed status when envelope is completed', async () => {
      // Arrange
      const seeded = await seedEnvelope({ status: 'completed' });

      // Act
      const response = await server.executeOperation(
        { query: ENVELOPE_QUERY, variables: { id: seeded.id } },
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

    const recipient = { name: 'John Doe', email: 'john@example.com' };

    it('should return new signingUrl for valid request', async () => {
      // Arrange - persisted envelope the provider also knows about
      const seeded = await seedEnvelope();
      addEnvelope(seeded.providerEnvelopeId, { status: 'sent', userId: 'user-123' });

      // Act
      const response = await server.executeOperation(
        {
          query: GET_SIGNING_URL_MUTATION,
          variables: { input: { envelopeId: seeded.id, recipient } },
        },
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
        // Verify audit log was created for session restart (PII-free metadata)
        const audit = await store.listAuditEntries(seeded.id);
        expect(audit).toHaveLength(1);
        expect(audit[0].action).toBe('session_restart');
        expect(audit[0].metadata).toEqual({ userId: 'user-123' });
        // Status is unchanged by a restart
        expect((await store.getEnvelopeById(seeded.id))!.status).toBe('sent');
      }
    });

    it('should return UNAUTHORIZED without auth', async () => {
      // Arrange
      const seeded = await seedEnvelope();

      // Act
      const response = await server.executeOperation(
        {
          query: GET_SIGNING_URL_MUTATION,
          variables: { input: { envelopeId: seeded.id, recipient } },
        },
        { contextValue: { userId: null } }
      );

      // Assert
      expect(response.body.kind).toBe('single');
      if (response.body.kind === 'single') {
        expect(response.body.singleResult.errors).toBeDefined();
        const error = response.body.singleResult.errors![0];
        expect(error.extensions?.code).toBe(ErrorCodes.UNAUTHORIZED);
      }
      // No audit entry for the rejected restart
      expect(await store.listAuditEntries(seeded.id)).toEqual([]);
    });

    it('should return VALIDATION_ERROR for an over-length recipient name', async () => {
      const seeded = await seedEnvelope();

      const response = await server.executeOperation(
        {
          query: GET_SIGNING_URL_MUTATION,
          variables: {
            input: {
              envelopeId: seeded.id,
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
      // Act
      const response = await server.executeOperation(
        {
          query: GET_SIGNING_URL_MUTATION,
          variables: { input: { envelopeId: randomUUID(), recipient } },
        },
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
      const seeded = await seedEnvelope({ userId: 'user-123' });
      addEnvelope(seeded.providerEnvelopeId, { status: 'sent', userId: 'user-123' });

      // Act
      const response = await server.executeOperation(
        {
          query: GET_SIGNING_URL_MUTATION,
          variables: { input: { envelopeId: seeded.id, recipient } },
        },
        { contextValue: { userId: 'different-user' } }
      );

      // Assert - should NOT reveal that envelope exists
      expect(response.body.kind).toBe('single');
      if (response.body.kind === 'single') {
        expect(response.body.singleResult.errors).toBeDefined();
        const error = response.body.singleResult.errors![0];
        expect(error.extensions?.code).toBe(ErrorCodes.ENVELOPE_NOT_FOUND);
      }
      expect(await store.listAuditEntries(seeded.id)).toEqual([]);
    });

    it('should return VALIDATION_ERROR for completed envelope', async () => {
      // Arrange - envelope is already completed
      const seeded = await seedEnvelope({ status: 'completed' });
      // Add envelope to MockProvider (not strictly needed since validation happens before provider call)
      addEnvelope(seeded.providerEnvelopeId, { status: 'completed', userId: 'user-123' });

      // Act
      const response = await server.executeOperation(
        {
          query: GET_SIGNING_URL_MUTATION,
          variables: { input: { envelopeId: seeded.id, recipient } },
        },
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
      expect(await store.listAuditEntries(seeded.id)).toEqual([]);
    });

    it('should return VALIDATION_ERROR for empty envelopeId', async () => {
      // Act
      const response = await server.executeOperation(
        {
          query: GET_SIGNING_URL_MUTATION,
          variables: { input: { envelopeId: '', recipient } },
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
            input: { envelopeId: randomUUID(), recipient: { name: '', email: 'john@example.com' } },
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
            input: { envelopeId: randomUUID(), recipient: { name: 'John', email: 'invalid' } },
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

    it('should return audit logs for owned envelope', async () => {
      // Arrange - three entries written in chronological order
      const seeded = await seedEnvelope();
      await store.appendAuditEntry({
        id: 'log-1',
        envelopeId: seeded.id,
        action: 'initiated',
        metadata: { contractType: 'loan_agreement', userId: 'user-123' },
      });
      await store.appendAuditEntry({
        id: 'log-2',
        envelopeId: seeded.id,
        action: 'session_restart',
        metadata: { userId: 'user-123' },
      });
      await store.appendAuditEntry({
        id: 'log-3',
        envelopeId: seeded.id,
        action: 'completed',
        metadata: { source: 'webhook' },
      });

      // Act
      const response = await server.executeOperation(
        { query: AUDIT_LOGS_QUERY, variables: { envelopeId: seeded.id } },
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
        // Verify order: most recent first
        expect(data.auditLogs.map((log) => log.action)).toEqual([
          'completed',
          'session_restart',
          'initiated',
        ]);
        expect(data.auditLogs.map((log) => log.id)).toEqual(['log-3', 'log-2', 'log-1']);
        // Verify timestamps are ISO strings
        const stored = await store.listAuditEntries(seeded.id);
        expect(data.auditLogs[0].timestamp).toBe(stored[0].timestamp.toISOString());
        // Verify metadata is serialized JSON
        expect(JSON.parse(data.auditLogs[0].metadata!)).toEqual({ source: 'webhook' });
      }
    });

    it('should return empty array for envelope with no logs', async () => {
      // Arrange
      const seeded = await seedEnvelope();

      // Act
      const response = await server.executeOperation(
        { query: AUDIT_LOGS_QUERY, variables: { envelopeId: seeded.id } },
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
      // Arrange - envelope exists (with logs) but user doesn't own it
      const seeded = await seedEnvelope({ userId: 'user-123' });
      await store.appendAuditEntry({
        id: randomUUID(),
        envelopeId: seeded.id,
        action: 'initiated',
        metadata: { userId: 'user-123' },
      });

      // Act
      const response = await server.executeOperation(
        { query: AUDIT_LOGS_QUERY, variables: { envelopeId: seeded.id } },
        { contextValue: { userId: 'different-user' } }
      );

      // Assert - should NOT reveal that envelope exists
      expect(response.body.kind).toBe('single');
      if (response.body.kind === 'single') {
        expect(response.body.singleResult.errors).toBeDefined();
        const error = response.body.singleResult.errors![0];
        expect(error.extensions?.code).toBe(ErrorCodes.ENVELOPE_NOT_FOUND);
        expect(response.body.singleResult.data?.auditLogs ?? null).toBeNull();
      }
    });

    it('should return UNAUTHORIZED without auth', async () => {
      // Arrange
      const seeded = await seedEnvelope();

      // Act
      const response = await server.executeOperation(
        { query: AUDIT_LOGS_QUERY, variables: { envelopeId: seeded.id } },
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
      // Arrange - a stored entry with no metadata (nullable column in Postgres)
      const seeded = await seedEnvelope();
      await store.appendAuditEntry({
        id: 'log-null',
        envelopeId: seeded.id,
        action: 'failed',
        metadata: null as unknown as Record<string, unknown>,
      });

      // Act
      const response = await server.executeOperation(
        { query: AUDIT_LOGS_QUERY, variables: { envelopeId: seeded.id } },
        { contextValue: { userId: 'user-123' } }
      );

      // Assert
      expect(response.body.kind).toBe('single');
      if (response.body.kind === 'single') {
        expect(response.body.singleResult.errors).toBeUndefined();
        const data = response.body.singleResult.data as {
          auditLogs: { id: string; metadata: string | null }[];
        };
        expect(data.auditLogs).toHaveLength(1);
        expect(data.auditLogs[0].metadata).toBeNull();
      }
    });
  });
});
