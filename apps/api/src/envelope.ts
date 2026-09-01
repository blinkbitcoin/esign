// Envelope repository for database CRUD operations
// Internal UUIDs only - never expose providerEnvelopeId to clients

import { randomUUID } from 'crypto';
import type { Knex } from 'knex';
import { knex } from './db';
import type { EnvelopeStatus } from './types';

// Re-export the canonical status type (defined in types.ts) for convenience
export type { EnvelopeStatus };

export interface Envelope {
  id: string;
  providerEnvelopeId: string;
  userId: string;
  contractType: string;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}

// Data required to create an envelope record
export interface CreateEnvelopeData {
  providerEnvelopeId: string;
  userId: string;
  contractType: string;
}

// Create a new envelope record in the database
// Accepts an optional transaction so callers (e.g. schema.ts's createEnvelope
// resolver) can persist the envelope and its audit log atomically.
export const createEnvelope = async (
  data: CreateEnvelopeData,
  trx: Knex | Knex.Transaction = knex
): Promise<Envelope> => {
  const [envelope] = await trx<Envelope>('Envelope')
    .insert({
      id: randomUUID(),
      providerEnvelopeId: data.providerEnvelopeId,
      userId: data.userId,
      contractType: data.contractType,
      status: 'sent',
    })
    .returning('*');

  return envelope;
};

// Get envelope by ID for a specific user (ownership check)
// Returns null if envelope not found OR user doesn't own it (no info leak)
export const getEnvelopeByIdForUser = async (
  id: string,
  userId: string
): Promise<Envelope | null> => {
  const envelope = await knex<Envelope>('Envelope')
    .where({ id, userId }) // Ownership check - only return if user owns the envelope
    .first();

  return envelope ?? null;
};

// Get envelope by internal ID (for internal operations only)
export const getEnvelopeById = async (id: string): Promise<Envelope | null> => {
  const envelope = await knex<Envelope>('Envelope').where({ id }).first();

  return envelope ?? null;
};

/**
 * Update envelope status (repository function - data access only)
 *
 * NOTE: This is a low-level repository function. Callers (webhook handlers,
 * resolvers) are responsible for calling logAuditEvent() after status changes
 * to maintain the audit trail. This separation keeps the repository focused
 * on data access while allowing callers to control transaction boundaries.
 * Accepts an optional transaction so the status update and its audit log
 * can be persisted atomically.
 */
export const updateEnvelopeStatus = async (
  id: string,
  status: EnvelopeStatus,
  trx: Knex | Knex.Transaction = knex
): Promise<Envelope> => {
  const [envelope] = await trx<Envelope>('Envelope')
    .where({ id })
    .update({ status, updatedAt: trx.fn.now() }, ['*']);

  if (!envelope) {
    throw new Error(`Envelope not found: ${id}`);
  }

  return envelope;
};

// Get envelope by the provider's envelope ID (for webhook processing)
export const getEnvelopeByProviderEnvelopeId = async (
  providerEnvelopeId: string
): Promise<Envelope | null> => {
  const envelope = await knex<Envelope>('Envelope').where({ providerEnvelopeId }).first();

  return envelope ?? null;
};
