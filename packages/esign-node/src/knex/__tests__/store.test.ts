// The Knex implementation of the envelope store port, against a mocked knex
// client (knex-mock-client) so no Postgres is needed.

import createKnex, { type Knex } from 'knex';
import { createTracker, MockClient, type Tracker } from 'knex-mock-client';
import { createKnexEnvelopeStore } from '../store';

const knex = createKnex({ client: MockClient });
const store = createKnexEnvelopeStore(knex);

const record = (overrides: Partial<Record<string, unknown>> = {}) => ({
  id: 'uuid-1',
  providerEnvelopeId: 'ds-1',
  userId: 'user-1',
  contractType: 'loan_agreement',
  status: 'sent',
  createdAt: new Date('2026-09-08T10:00:00Z'),
  updatedAt: new Date('2026-09-08T10:00:00Z'),
  ...overrides,
});

describe('createKnexEnvelopeStore', () => {
  let tracker: Tracker;

  beforeAll(() => {
    tracker = createTracker(knex);
  });

  afterEach(() => {
    tracker.reset();
  });

  it('inserts an envelope with the given fields and returns the row', async () => {
    tracker.on.insert('Envelope').response([record()]);
    const created = await store.createEnvelope({
      id: 'uuid-1',
      providerEnvelopeId: 'ds-1',
      userId: 'user-1',
      contractType: 'loan_agreement',
      status: 'sent',
    });
    expect(tracker.history.insert).toHaveLength(1);
    expect(tracker.history.insert[0].bindings).toEqual(
      expect.arrayContaining([
        'uuid-1',
        'ds-1',
        'user-1',
        'loan_agreement',
        'sent',
      ]),
    );
    expect(created).toEqual(record());
  });

  it('reads an envelope by id and user (ownership in the query)', async () => {
    tracker.on.select('Envelope').response([record()]);
    expect(await store.getEnvelopeByIdForUser('uuid-1', 'user-1')).toEqual(
      record(),
    );
    expect(tracker.history.select[0].bindings).toEqual(
      expect.arrayContaining(['uuid-1', 'user-1']),
    );
  });

  it('returns null when no row matches (missing or another owner)', async () => {
    tracker.on.select('Envelope').response([]);
    expect(
      await store.getEnvelopeByIdForUser('uuid-1', 'someone-else'),
    ).toBeNull();
    expect(await store.getEnvelopeById('nope')).toBeNull();
    expect(await store.getEnvelopeByProviderEnvelopeId('nope')).toBeNull();
  });

  it('reads by internal id and by provider id', async () => {
    tracker.on.select('Envelope').response([record()]);
    expect(await store.getEnvelopeById('uuid-1')).toEqual(record());
    expect(await store.getEnvelopeByProviderEnvelopeId('ds-1')).toEqual(
      record(),
    );
    expect(tracker.history.select[1].bindings).toEqual(
      expect.arrayContaining(['ds-1']),
    );
  });

  it('updates the status (and updatedAt) returning the row', async () => {
    tracker.on.update('Envelope').response([record({ status: 'completed' })]);
    const updated = await store.updateEnvelopeStatus('uuid-1', 'completed');
    expect(updated.status).toBe('completed');
    expect(tracker.history.update[0].bindings).toEqual(
      expect.arrayContaining(['completed', 'uuid-1']),
    );
  });

  it('throws when updating an envelope that does not exist', async () => {
    tracker.on.update('Envelope').response([]);
    await expect(
      store.updateEnvelopeStatus('missing', 'completed'),
    ).rejects.toThrow('Envelope not found: missing');
  });

  it('appends an audit entry', async () => {
    tracker.on.insert('AuditLog').response([]);
    await store.appendAuditEntry({
      id: 'audit-1',
      envelopeId: 'uuid-1',
      action: 'initiated',
      metadata: { contractType: 'loan_agreement' },
    });
    expect(tracker.history.insert[0].bindings).toEqual(
      expect.arrayContaining(['audit-1', 'uuid-1', 'initiated']),
    );
  });

  it('lists audit entries newest first, mapping metadata', async () => {
    const rows = [
      {
        id: 'a2',
        envelopeId: 'uuid-1',
        action: 'completed',
        timestamp: new Date(2),
        metadata: { source: 'webhook' },
      },
      {
        id: 'a1',
        envelopeId: 'uuid-1',
        action: 'initiated',
        timestamp: new Date(1),
        metadata: null,
      },
    ];
    tracker.on.select('AuditLog').response(rows);
    const entries = await store.listAuditEntries('uuid-1');
    expect(entries).toEqual(rows);
    expect(tracker.history.select[0].sql).toMatch(/order by "timestamp" desc/i);
  });

  it('logs (without PII) through the given logger and rethrows when the audit query fails', async () => {
    const logger = { log: jest.fn(), warn: jest.fn(), error: jest.fn() };
    const logging = createKnexEnvelopeStore(knex, { logger });
    tracker.on.select('AuditLog').simulateError('connection lost');
    await expect(logging.listAuditEntries('uuid-1')).rejects.toThrow(
      'connection lost',
    );
    expect(logger.error).toHaveBeenCalledWith(
      'Failed to query audit logs:',
      expect.objectContaining({
        envelopeId: 'uuid-1',
        error: expect.stringContaining('connection lost'),
      }),
    );
  });

  it('reports a non-Error rejection as unknown', async () => {
    const logger = { log: jest.fn(), warn: jest.fn(), error: jest.fn() };
    // A db whose query chain rejects with a bare value, not an Error
    const db = Object.assign(
      () => ({ where: () => ({ orderBy: () => Promise.reject('boom') }) }),
      { fn: { now: () => 'now()' } },
    ) as unknown as Knex;
    await expect(
      createKnexEnvelopeStore(db, { logger }).listAuditEntries('uuid-1'),
    ).rejects.toBe('boom');
    expect(logger.error).toHaveBeenCalledWith(
      'Failed to query audit logs:',
      expect.objectContaining({ error: 'unknown error' }),
    );
  });

  it('defaults to the console logger', async () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    tracker.on.select('AuditLog').simulateError('connection lost');
    await expect(store.listAuditEntries('uuid-1')).rejects.toThrow();
    expect(errorSpy).toHaveBeenCalledWith(
      'Failed to query audit logs:',
      expect.anything(),
    );
    errorSpy.mockRestore();
  });

  it('runs a transaction, handing the callback a store bound to it', async () => {
    tracker.on.insert('Envelope').response([record()]);
    tracker.on.insert('AuditLog').response([]);
    const result = await store.transaction(async tx => {
      const created = await tx.createEnvelope({
        id: 'uuid-1',
        providerEnvelopeId: 'ds-1',
        userId: 'user-1',
        contractType: 'loan_agreement',
        status: 'sent',
      });
      await tx.appendAuditEntry({
        id: 'a1',
        envelopeId: created.id,
        action: 'initiated',
        metadata: {},
      });
      return created.id;
    });
    expect(result).toBe('uuid-1');
    expect(tracker.history.insert).toHaveLength(2);
  });
});
