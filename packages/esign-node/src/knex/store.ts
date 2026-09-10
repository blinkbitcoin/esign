// The Knex/Postgres implementation of the envelope store port, for hosts
// that keep envelopes in their own Postgres. Internal UUIDs only -
// providerEnvelopeId never leaves the store's callers. Any Knex instance
// works (a transaction included); the host owns the connection.

import type { Knex } from 'knex';
import type { AuditEntry } from '../audit';
import type { Logger } from '../log';
import { consoleLogger } from '../log';
import type {
  EnvelopeRecord,
  EnvelopeStore,
  NewAuditEntry,
  NewEnvelope,
} from '../store';
import type { EnvelopeStatus } from '../types';

export interface KnexEnvelopeStoreOptions {
  logger?: Logger;
}

export const createKnexEnvelopeStore = (
  db: Knex | Knex.Transaction,
  options: KnexEnvelopeStoreOptions = {},
): EnvelopeStore => {
  const logger = options.logger ?? consoleLogger;
  return {
    // A Knex transaction wraps every write made through the store it yields
    transaction: fn =>
      db.transaction(trx => fn(createKnexEnvelopeStore(trx, options))),

    async createEnvelope(data: NewEnvelope): Promise<EnvelopeRecord> {
      const [envelope] = await db<EnvelopeRecord>('Envelope')
        .insert(data)
        .returning('*');
      return envelope;
    },

    // Ownership check in the query: null when missing OR owned by someone else
    async getEnvelopeByIdForUser(
      id: string,
      userId: string,
    ): Promise<EnvelopeRecord | null> {
      const envelope = await db<EnvelopeRecord>('Envelope')
        .where({ id, userId })
        .first();
      return envelope ?? null;
    },

    async getEnvelopeById(id: string): Promise<EnvelopeRecord | null> {
      const envelope = await db<EnvelopeRecord>('Envelope')
        .where({ id })
        .first();
      return envelope ?? null;
    },

    async getEnvelopeByProviderEnvelopeId(
      providerEnvelopeId: string,
    ): Promise<EnvelopeRecord | null> {
      const envelope = await db<EnvelopeRecord>('Envelope')
        .where({ providerEnvelopeId })
        .first();
      return envelope ?? null;
    },

    async updateEnvelopeStatus(
      id: string,
      status: EnvelopeStatus,
    ): Promise<EnvelopeRecord> {
      const [envelope] = await db<EnvelopeRecord>('Envelope')
        .where({ id })
        .update({ status, updatedAt: db.fn.now() }, ['*']);
      if (!envelope) {
        throw new Error(`Envelope not found: ${id}`);
      }
      return envelope;
    },

    async appendAuditEntry(entry: NewAuditEntry): Promise<void> {
      await db('AuditLog').insert(entry);
    },

    // Newest first (the audit trail is queried per envelope for compliance)
    async listAuditEntries(envelopeId: string): Promise<AuditEntry[]> {
      try {
        const logs = await db<AuditEntry>('AuditLog')
          .where({ envelopeId })
          .orderBy('timestamp', 'desc');
        return logs.map(log => ({
          id: log.id,
          envelopeId: log.envelopeId,
          action: log.action,
          timestamp: log.timestamp,
          metadata: log.metadata as Record<string, unknown> | null,
        }));
      } catch (error) {
        // Log without PII (envelopeId is an internal UUID) and let the caller decide
        logger.error('Failed to query audit logs:', {
          envelopeId,
          error: error instanceof Error ? error.message : 'unknown error',
          timestamp: new Date().toISOString(),
        });
        throw error;
      }
    },
  };
};
