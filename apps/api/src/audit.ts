// Audit logging utility for tracking envelope actions
// Never includes PII: no email, no name, no document content

import { randomUUID } from 'crypto';
import type { Knex } from 'knex';
import { knex } from './db';

// Allowed audit actions
export type AuditAction =
  | 'initiated'
  | 'completed'
  | 'failed'
  | 'voided'
  | 'declined'
  | 'session_restart'
  | 'creation_failed';

// Metadata that can be logged (no PII allowed)
export interface AuditMetadata {
  contractType?: string;
  userId?: string;
  source?: 'api' | 'webhook';
  errorCode?: string; // Error code for failure tracking
}

// Allowed metadata keys - runtime validation to prevent PII leakage
const ALLOWED_METADATA_KEYS: ReadonlySet<string> = new Set([
  'contractType',
  'userId',
  'source',
  'errorCode',
]);

// Sanitize metadata to only include allowed keys (prevents PII leakage at runtime)
const sanitizeMetadata = (metadata?: AuditMetadata): Record<string, unknown> => {
  if (!metadata) return {};

  const sanitized: Record<string, unknown> = {};
  for (const key of Object.keys(metadata)) {
    if (ALLOWED_METADATA_KEYS.has(key)) {
      sanitized[key] = (metadata as Record<string, unknown>)[key];
    }
  }
  return sanitized;
};

// Log an audit event for envelope actions
// Accepts an optional transaction so callers (e.g. schema.ts's createEnvelope
// resolver) can persist the envelope and its audit log atomically.
export const logAuditEvent = async (
  envelopeId: string,
  action: AuditAction,
  metadata?: AuditMetadata,
  trx: Knex | Knex.Transaction = knex
): Promise<void> => {
  await trx('AuditLog').insert({
    id: randomUUID(),
    envelopeId,
    action,
    metadata: sanitizeMetadata(metadata),
  });
};

// Audit log entry type for query results
export interface AuditLogEntry {
  id: string;
  envelopeId: string;
  action: string;
  timestamp: Date;
  metadata: Record<string, unknown> | null;
}

/**
 * Query audit logs by envelope ID (compliance requirement: the audit
 * trail must be queryable per envelope)
 * Returns logs ordered by timestamp descending (most recent first)
 * @param envelopeId - The internal envelope UUID to query logs for
 * @returns Array of audit log entries, newest first
 * @throws Re-throws database errors after logging (no PII in logs)
 */
export const getAuditLogsByEnvelopeId = async (envelopeId: string): Promise<AuditLogEntry[]> => {
  try {
    const logs = await knex<AuditLogEntry>('AuditLog')
      .where({ envelopeId })
      .orderBy('timestamp', 'desc');

    return logs.map((log) => ({
      id: log.id,
      envelopeId: log.envelopeId,
      action: log.action,
      timestamp: log.timestamp,
      metadata: log.metadata as Record<string, unknown> | null,
    }));
  } catch (error) {
    // Log error without PII (envelopeId is internal UUID, not sensitive)
    console.error('Failed to query audit logs:', {
      envelopeId,
      /* v8 ignore next -- knex/pg always reject with an Error instance; this is an unreachable defensive fallback */
      error: error instanceof Error ? error.message : 'unknown error',
      timestamp: new Date().toISOString(),
    });
    throw error; // Re-throw for caller to handle
  }
};
