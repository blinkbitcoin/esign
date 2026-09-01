// Security Tests: ID Protection
// Verifies that DocuSign envelope IDs are NEVER exposed to clients
// These tests serve as regression guards against accidental ID exposure

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
import { ErrorCodes } from '../src/errors';
import { resolvers, typeDefs } from '../src/schema';

import type { GraphQLContext } from '../src/types';

const mockCreateEnvelope = vi.mocked(createEnvelope);
const mockGetEnvelopeByIdForUser = vi.mocked(getEnvelopeByIdForUser);
const mockLogAuditEvent = vi.mocked(logAuditEvent);
const mockGetAuditLogsByEnvelopeId = vi.mocked(getAuditLogsByEnvelopeId);

describe('Security: ID Protection', () => {
  let server: ApolloServer<GraphQLContext>;

  beforeAll(async () => {
    server = new ApolloServer<GraphQLContext>({ typeDefs, resolvers });
    await server.start();
  });

  afterAll(async () => {
    await server.stop();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    // Setup default mock for envelope creation with explicit providerEnvelopeId
    mockCreateEnvelope.mockImplementation(async (data) => ({
      id: 'internal-uuid-12345',
      providerEnvelopeId: 'DOCUSIGN-SECRET-ID-NEVER-EXPOSE',
      userId: data.userId,
      contractType: data.contractType,
      status: 'sent',
      createdAt: new Date(),
      updatedAt: new Date(),
    }));
    mockLogAuditEvent.mockResolvedValue(undefined);
  });

  // Verify Envelope type in schema has exactly these fields
  describe('GraphQL Schema Type Verification (AC: 2, 4, 5)', () => {
    it('should have Envelope type with ONLY id, status, contractType, createdAt fields', async () => {
      // This test introspects the schema to verify the Envelope type
      const introspectionQuery = `
        query {
          __type(name: "Envelope") {
            name
            fields {
              name
            }
          }
        }
      `;

      const response = await server.executeOperation(
        { query: introspectionQuery },
        { contextValue: { userId: null } }
      );

      expect(response.body.kind).toBe('single');
      if (response.body.kind === 'single') {
        const data = response.body.singleResult.data as {
          __type: { name: string; fields: { name: string }[] };
        };
        const fieldNames = data.__type.fields.map((f) => f.name).sort();

        // SECURITY CRITICAL: Envelope type must NEVER have providerEnvelopeId
        expect(fieldNames).toEqual(['contractType', 'createdAt', 'id', 'status']);
        expect(fieldNames).not.toContain('providerEnvelopeId');
      }
    });

    it('should have EnvelopeResult type with ONLY envelopeId and signingUrl', async () => {
      const introspectionQuery = `
        query {
          __type(name: "EnvelopeResult") {
            name
            fields {
              name
            }
          }
        }
      `;

      const response = await server.executeOperation(
        { query: introspectionQuery },
        { contextValue: { userId: null } }
      );

      expect(response.body.kind).toBe('single');
      if (response.body.kind === 'single') {
        const data = response.body.singleResult.data as {
          __type: { name: string; fields: { name: string }[] };
        };
        const fieldNames = data.__type.fields.map((f) => f.name).sort();

        // SECURITY CRITICAL: EnvelopeResult must not have providerEnvelopeId
        expect(fieldNames).toEqual(['envelopeId', 'signingUrl']);
        expect(fieldNames).not.toContain('providerEnvelopeId');
      }
    });

    it('should have SigningUrlResult type with ONLY signingUrl field', async () => {
      const introspectionQuery = `
        query {
          __type(name: "SigningUrlResult") {
            name
            fields {
              name
            }
          }
        }
      `;

      const response = await server.executeOperation(
        { query: introspectionQuery },
        { contextValue: { userId: null } }
      );

      expect(response.body.kind).toBe('single');
      if (response.body.kind === 'single') {
        const data = response.body.singleResult.data as {
          __type: { name: string; fields: { name: string }[] };
        };
        const fieldNames = data.__type.fields.map((f) => f.name).sort();

        // SECURITY CRITICAL: SigningUrlResult must not have providerEnvelopeId or envelopeId
        expect(fieldNames).toEqual(['signingUrl']);
        expect(fieldNames).not.toContain('providerEnvelopeId');
        expect(fieldNames).not.toContain('envelopeId');
      }
    });

    it('should have AuditLog type without providerEnvelopeId field', async () => {
      const introspectionQuery = `
        query {
          __type(name: "AuditLog") {
            name
            fields {
              name
            }
          }
        }
      `;

      const response = await server.executeOperation(
        { query: introspectionQuery },
        { contextValue: { userId: null } }
      );

      expect(response.body.kind).toBe('single');
      if (response.body.kind === 'single') {
        const data = response.body.singleResult.data as {
          __type: { name: string; fields: { name: string }[] };
        };
        const fieldNames = data.__type.fields.map((f) => f.name).sort();

        // SECURITY CRITICAL: AuditLog must not have providerEnvelopeId
        expect(fieldNames).toEqual(['action', 'id', 'metadata', 'timestamp']);
        expect(fieldNames).not.toContain('providerEnvelopeId');
        // envelopeId is intentionally omitted from GraphQL AuditLog type for security
        // (clients query by envelopeId, they don't need it returned in each log entry)
        expect(fieldNames).not.toContain('envelopeId');
      }
    });
  });

  // Verify createEnvelope never returns providerEnvelopeId
  describe('createEnvelope Response Security (AC: 1, 6)', () => {
    const CREATE_ENVELOPE_MUTATION = `
      mutation CreateEnvelope($input: CreateEnvelopeInput!) {
        createEnvelope(input: $input) {
          envelopeId
          signingUrl
        }
      }
    `;

    const validInput = {
      contractType: 'security_test',
      recipient: { name: 'Test User', email: 'test@example.com' },
    };

    it('should return ONLY envelopeId (internal UUID) and signingUrl', async () => {
      const response = await server.executeOperation(
        { query: CREATE_ENVELOPE_MUTATION, variables: { input: validInput } },
        { contextValue: { userId: 'user-123' } }
      );

      expect(response.body.kind).toBe('single');
      if (response.body.kind === 'single') {
        expect(response.body.singleResult.errors).toBeUndefined();
        const data = response.body.singleResult.data as Record<string, unknown>;
        const result = data.createEnvelope as Record<string, unknown>;

        // CRITICAL: Verify exact fields returned
        expect(Object.keys(result).sort()).toEqual(['envelopeId', 'signingUrl']);
        expect(result).not.toHaveProperty('providerEnvelopeId');
      }
    });

    it('should return internal UUID as envelopeId, NOT providerEnvelopeId', async () => {
      const response = await server.executeOperation(
        { query: CREATE_ENVELOPE_MUTATION, variables: { input: validInput } },
        { contextValue: { userId: 'user-123' } }
      );

      expect(response.body.kind).toBe('single');
      if (response.body.kind === 'single') {
        const data = response.body.singleResult.data as {
          createEnvelope: { envelopeId: string; signingUrl: string };
        };

        // envelopeId should be internal UUID (from our mock: 'internal-uuid-12345')
        expect(data.createEnvelope.envelopeId).toBe('internal-uuid-12345');
        // envelopeId should NOT be the docusign ID
        expect(data.createEnvelope.envelopeId).not.toBe('DOCUSIGN-SECRET-ID-NEVER-EXPOSE');
        expect(data.createEnvelope.envelopeId).not.toContain('DOCUSIGN');
      }
    });

    it('should not leak providerEnvelopeId even if requested via GraphQL (schema protection)', async () => {
      // Attempt to request providerEnvelopeId field - should fail at schema level
      const maliciousQuery = `
        mutation CreateEnvelope($input: CreateEnvelopeInput!) {
          createEnvelope(input: $input) {
            envelopeId
            signingUrl
            providerEnvelopeId
          }
        }
      `;

      const response = await server.executeOperation(
        { query: maliciousQuery, variables: { input: validInput } },
        { contextValue: { userId: 'user-123' } }
      );

      // Should fail because providerEnvelopeId is not in schema
      expect(response.body.kind).toBe('single');
      if (response.body.kind === 'single') {
        expect(response.body.singleResult.errors).toBeDefined();
        expect(response.body.singleResult.errors!.length).toBeGreaterThan(0);
        // Error should be about unknown field
        expect(response.body.singleResult.errors![0].message).toContain('providerEnvelopeId');
      }
    });
  });

  // Verify envelope query never returns providerEnvelopeId
  describe('envelope Query Response Security (AC: 1, 6)', () => {
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
      id: 'internal-uuid-456',
      providerEnvelopeId: 'DOCUSIGN-SECRET-ID-NEVER-EXPOSE',
      userId: 'user-123',
      contractType: 'loan_agreement',
      status: 'sent',
      createdAt: new Date('2026-02-01T12:00:00.000Z'),
      updatedAt: new Date('2026-02-01T12:00:00.000Z'),
    };

    it('should return ONLY id, status, contractType, createdAt', async () => {
      mockGetEnvelopeByIdForUser.mockResolvedValue(mockEnvelope);

      const response = await server.executeOperation(
        { query: ENVELOPE_QUERY, variables: { id: 'internal-uuid-456' } },
        { contextValue: { userId: 'user-123' } }
      );

      expect(response.body.kind).toBe('single');
      if (response.body.kind === 'single') {
        expect(response.body.singleResult.errors).toBeUndefined();
        const data = response.body.singleResult.data as Record<string, unknown>;
        const envelope = data.envelope as Record<string, unknown>;

        // CRITICAL: Verify exact fields returned
        expect(Object.keys(envelope).sort()).toEqual(['contractType', 'createdAt', 'id', 'status']);
        expect(envelope).not.toHaveProperty('providerEnvelopeId');
      }
    });

    it('should not leak providerEnvelopeId even if requested via GraphQL', async () => {
      mockGetEnvelopeByIdForUser.mockResolvedValue(mockEnvelope);

      // Attempt to request providerEnvelopeId field
      const maliciousQuery = `
        query GetEnvelope($id: String!) {
          envelope(id: $id) {
            id
            status
            providerEnvelopeId
          }
        }
      `;

      const response = await server.executeOperation(
        { query: maliciousQuery, variables: { id: 'internal-uuid-456' } },
        { contextValue: { userId: 'user-123' } }
      );

      // Should fail because providerEnvelopeId is not in schema
      expect(response.body.kind).toBe('single');
      if (response.body.kind === 'single') {
        expect(response.body.singleResult.errors).toBeDefined();
        expect(response.body.singleResult.errors![0].message).toContain('providerEnvelopeId');
      }
    });
  });

  // Verify auditLogs query never exposes providerEnvelopeId
  describe('auditLogs Query Response Security (AC: 2)', () => {
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
      id: 'internal-uuid-789',
      providerEnvelopeId: 'DOCUSIGN-SECRET-ID-NEVER-EXPOSE',
      userId: 'user-123',
      contractType: 'nda',
      status: 'completed',
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const mockAuditLogs = [
      {
        id: 'log-1',
        envelopeId: 'internal-uuid-789',
        action: 'completed',
        timestamp: new Date(),
        metadata: { source: 'webhook', contractType: 'nda' },
      },
    ];

    it('should return audit logs without providerEnvelopeId in any field', async () => {
      mockGetEnvelopeByIdForUser.mockResolvedValue(mockEnvelope);
      mockGetAuditLogsByEnvelopeId.mockResolvedValue(mockAuditLogs);

      const response = await server.executeOperation(
        { query: AUDIT_LOGS_QUERY, variables: { envelopeId: 'internal-uuid-789' } },
        { contextValue: { userId: 'user-123' } }
      );

      expect(response.body.kind).toBe('single');
      if (response.body.kind === 'single') {
        expect(response.body.singleResult.errors).toBeUndefined();
        const data = response.body.singleResult.data as {
          auditLogs: { id: string; action: string; timestamp: string; metadata: string | null }[];
        };

        // Verify fields
        expect(data.auditLogs).toHaveLength(1);
        const log = data.auditLogs[0];
        expect(Object.keys(log).sort()).toEqual(['action', 'id', 'metadata', 'timestamp']);
        expect(log).not.toHaveProperty('providerEnvelopeId');
        expect(log).not.toHaveProperty('envelopeId'); // envelopeId is for internal use, not exposed

        // Verify metadata doesn't contain providerEnvelopeId
        const metadata = JSON.parse(log.metadata!);
        expect(metadata).not.toHaveProperty('providerEnvelopeId');
      }
    });
  });

  // Verify error responses contain no provider IDs
  describe('Error Response Security (AC: 3)', () => {
    it('should not include providerEnvelopeId in ENVELOPE_NOT_FOUND error', async () => {
      mockGetEnvelopeByIdForUser.mockResolvedValue(null);

      const response = await server.executeOperation(
        {
          query: `query { envelope(id: "non-existent") { id status } }`,
        },
        { contextValue: { userId: 'user-123' } }
      );

      expect(response.body.kind).toBe('single');
      if (response.body.kind === 'single') {
        expect(response.body.singleResult.errors).toBeDefined();
        const error = response.body.singleResult.errors![0];

        // Error code and message should be generic
        expect(error.extensions?.code).toBe(ErrorCodes.ENVELOPE_NOT_FOUND);
        expect(error.message).toBe('Envelope not found');

        // Error should NOT contain any UUID-like strings or provider references
        expect(error.message).not.toContain('docusign');
        expect(error.message).not.toContain('DOCUSIGN');
        expect(error.message).not.toMatch(
          /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i
        );
      }
    });

    it('should not include provider details in UNAUTHORIZED error', async () => {
      const response = await server.executeOperation(
        {
          query: `query { envelope(id: "test-id") { id status } }`,
        },
        { contextValue: { userId: null } }
      );

      expect(response.body.kind).toBe('single');
      if (response.body.kind === 'single') {
        expect(response.body.singleResult.errors).toBeDefined();
        const error = response.body.singleResult.errors![0];

        expect(error.extensions?.code).toBe(ErrorCodes.UNAUTHORIZED);
        expect(error.message).not.toContain('docusign');
        expect(error.message).not.toContain('provider');
      }
    });

    it('should not include provider details in VALIDATION_ERROR', async () => {
      const response = await server.executeOperation(
        {
          query: `query { envelope(id: "") { id status } }`,
        },
        { contextValue: { userId: 'user-123' } }
      );

      expect(response.body.kind).toBe('single');
      if (response.body.kind === 'single') {
        expect(response.body.singleResult.errors).toBeDefined();
        const error = response.body.singleResult.errors![0];

        expect(error.extensions?.code).toBe(ErrorCodes.VALIDATION_ERROR);
        expect(error.message).not.toContain('docusign');
        expect(error.message).not.toContain('provider');
      }
    });
  });

  // Comprehensive field verification across all responses
  describe('Comprehensive ID Protection Verification', () => {
    it('should verify providerEnvelopeId is stored in the database but never returned', async () => {
      // Create envelope
      const createMutation = `
        mutation CreateEnvelope($input: CreateEnvelopeInput!) {
          createEnvelope(input: $input) {
            envelopeId
            signingUrl
          }
        }
      `;

      await server.executeOperation(
        {
          query: createMutation,
          variables: {
            input: {
              contractType: 'test',
              recipient: { name: 'Test', email: 'test@example.com' },
            },
          },
        },
        { contextValue: { userId: 'user-123' } }
      );

      // Verify createEnvelope was called with providerEnvelopeId
      expect(mockCreateEnvelope).toHaveBeenCalled();
      const createCall = mockCreateEnvelope.mock.calls[0][0];
      expect(createCall.providerEnvelopeId).toBeDefined();

      // This confirms providerEnvelopeId IS stored in the database
      // Combined with the schema tests above, we prove it's stored but never exposed
    });
  });
});
