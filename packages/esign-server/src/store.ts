// The envelope STORE port: what the domain needs from persistence. A host
// implements it over its database (the esign service uses Knex/Postgres);
// createMemoryEnvelopeStore is a complete in-memory implementation for tests
// and for hosts that keep envelope state elsewhere.

import type { AuditEntry } from './audit';
import type { EnvelopeStatus } from './types';

// Internal UUIDs only - providerEnvelopeId is never exposed to clients
export interface EnvelopeRecord {
  id: string;
  providerEnvelopeId: string;
  userId: string;
  contractType: string;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface NewEnvelope {
  id: string;
  providerEnvelopeId: string;
  userId: string;
  contractType: string;
  status: EnvelopeStatus;
}

export interface NewAuditEntry {
  id: string;
  envelopeId: string;
  action: string;
  metadata: Record<string, unknown>;
}

export interface EnvelopeStore {
  // Run `fn` atomically: every write through the store it receives commits
  // together or not at all
  transaction<T>(fn: (store: EnvelopeStore) => Promise<T>): Promise<T>;

  createEnvelope(data: NewEnvelope): Promise<EnvelopeRecord>;
  // Ownership check: null when missing OR owned by someone else (no info leak)
  getEnvelopeByIdForUser(
    id: string,
    userId: string,
  ): Promise<EnvelopeRecord | null>;
  getEnvelopeById(id: string): Promise<EnvelopeRecord | null>;
  getEnvelopeByProviderEnvelopeId(
    providerEnvelopeId: string,
  ): Promise<EnvelopeRecord | null>;
  // Throws when the envelope does not exist
  updateEnvelopeStatus(
    id: string,
    status: EnvelopeStatus,
  ): Promise<EnvelopeRecord>;

  appendAuditEntry(entry: NewAuditEntry): Promise<void>;
  // Newest first
  listAuditEntries(envelopeId: string): Promise<AuditEntry[]>;
}

// In-memory store. Transactions snapshot both tables and restore them when
// the callback throws, giving the same all-or-nothing guarantee a database
// transaction does.
export const createMemoryEnvelopeStore = (
  now: () => Date = () => new Date(),
): EnvelopeStore => {
  let envelopes = new Map<string, EnvelopeRecord>();
  let audit: AuditEntry[] = [];

  const store: EnvelopeStore = {
    async transaction(fn) {
      const envelopesBefore = new Map(
        [...envelopes].map(([id, record]) => [id, { ...record }]),
      );
      const auditBefore = audit.map(entry => ({ ...entry }));
      try {
        return await fn(store);
      } catch (error) {
        envelopes = envelopesBefore;
        audit = auditBefore;
        throw error;
      }
    },

    async createEnvelope(data) {
      const timestamp = now();
      const record: EnvelopeRecord = {
        ...data,
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      envelopes.set(record.id, record);
      return { ...record };
    },

    async getEnvelopeByIdForUser(id, userId) {
      const record = envelopes.get(id);
      return record && record.userId === userId ? { ...record } : null;
    },

    async getEnvelopeById(id) {
      const record = envelopes.get(id);
      return record ? { ...record } : null;
    },

    async getEnvelopeByProviderEnvelopeId(providerEnvelopeId) {
      for (const record of envelopes.values()) {
        if (record.providerEnvelopeId === providerEnvelopeId) {
          return { ...record };
        }
      }
      return null;
    },

    async updateEnvelopeStatus(id, status) {
      const record = envelopes.get(id);
      if (!record) {
        throw new Error(`Envelope not found: ${id}`);
      }
      const updated = { ...record, status, updatedAt: now() };
      envelopes.set(id, updated);
      return { ...updated };
    },

    async appendAuditEntry(entry) {
      audit.push({ ...entry, timestamp: now() });
    },

    async listAuditEntries(envelopeId) {
      return audit
        .filter(entry => entry.envelopeId === envelopeId)
        .map(entry => ({ ...entry }))
        .reverse();
    },
  };
  return store;
};
