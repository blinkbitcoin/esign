// Test data factories for E2E tests
// Composable factory functions with support for overrides

import { randomUUID } from 'crypto';
import type { AuditLogEntry } from '../../src/audit';

import type { Envelope } from '../../src/envelope';
import { knex } from './setup';

// Default values for envelope creation
const envelopeDefaults = {
  userId: 'test-user-123',
  contractType: 'loan_agreement',
  status: 'sent',
};

// Create a test envelope with optional overrides
export const createTestEnvelope = async (
  overrides: Partial<{
    id: string;
    providerEnvelopeId: string;
    userId: string;
    contractType: string;
    status: string;
  }> = {}
): Promise<Envelope> => {
  const [envelope] = await knex<Envelope>('Envelope')
    .insert({
      id: overrides.id ?? randomUUID(),
      providerEnvelopeId: overrides.providerEnvelopeId ?? `ds-${randomUUID()}`,
      userId: overrides.userId ?? envelopeDefaults.userId,
      contractType: overrides.contractType ?? envelopeDefaults.contractType,
      status: overrides.status ?? envelopeDefaults.status,
    })
    .returning('*');

  return envelope;
};

// Create a test audit log for an envelope
export const createTestAuditLog = async (
  envelopeId: string,
  overrides: Partial<{
    id: string;
    action: string;
    metadata: Record<string, unknown>;
  }> = {}
): Promise<AuditLogEntry> => {
  const [auditLog] = await knex<AuditLogEntry>('AuditLog')
    .insert({
      id: overrides.id ?? randomUUID(),
      envelopeId,
      action: overrides.action ?? 'initiated',
      metadata: overrides.metadata ?? { source: 'test' },
    })
    .returning('*');

  return auditLog;
};

// Clean all test data (useful for test isolation within a file)
export const cleanTestData = async (): Promise<void> => {
  await knex.raw('TRUNCATE TABLE "AuditLog", "Envelope" CASCADE');
};
