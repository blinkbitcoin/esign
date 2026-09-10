import { createMemoryEnvelopeStore, type EnvelopeStore } from '../store';

// A clock that advances one second per read, so timestamps are distinct
const ticking = () => {
  let t = Date.UTC(2026, 0, 1);
  return () => new Date((t += 1000));
};

const seed = async (store: EnvelopeStore, id = 'env-1', userId = 'user-1') =>
  store.createEnvelope({
    id,
    providerEnvelopeId: `ds-${id}`,
    userId,
    contractType: 'nda',
    status: 'sent',
  });

describe('createMemoryEnvelopeStore', () => {
  describe('createEnvelope', () => {
    it('stores the record with matching created/updated timestamps', async () => {
      const store = createMemoryEnvelopeStore(ticking());
      const record = await seed(store);
      expect(record).toEqual({
        id: 'env-1',
        providerEnvelopeId: 'ds-env-1',
        userId: 'user-1',
        contractType: 'nda',
        status: 'sent',
        createdAt: new Date(Date.UTC(2026, 0, 1) + 1000),
        updatedAt: new Date(Date.UTC(2026, 0, 1) + 1000),
      });
      expect(await store.getEnvelopeById('env-1')).toEqual(record);
    });

    it('uses the wall clock by default', async () => {
      const before = Date.now();
      const record = await seed(createMemoryEnvelopeStore());
      expect(record.createdAt.getTime()).toBeGreaterThanOrEqual(before);
      expect(record.createdAt.getTime()).toBeLessThanOrEqual(Date.now());
    });

    it('returns copies: mutating a returned record does not touch the store', async () => {
      const store = createMemoryEnvelopeStore();
      const created = await seed(store);
      created.status = 'completed';
      const fetched = await store.getEnvelopeById('env-1');
      expect(fetched?.status).toBe('sent');
      fetched!.status = 'voided';
      expect((await store.getEnvelopeById('env-1'))?.status).toBe('sent');
      const owned = await store.getEnvelopeByIdForUser('env-1', 'user-1');
      owned!.status = 'declined';
      const byProvider =
        await store.getEnvelopeByProviderEnvelopeId('ds-env-1');
      expect(byProvider?.status).toBe('sent');
      byProvider!.status = 'declined';
      expect((await store.getEnvelopeById('env-1'))?.status).toBe('sent');
    });
  });

  describe('getEnvelopeByIdForUser', () => {
    it('returns the envelope for its owner', async () => {
      const store = createMemoryEnvelopeStore();
      await seed(store);
      expect(
        await store.getEnvelopeByIdForUser('env-1', 'user-1'),
      ).toMatchObject({ id: 'env-1', userId: 'user-1' });
    });

    it('returns null for another user (no information leak) and for unknown ids', async () => {
      const store = createMemoryEnvelopeStore();
      await seed(store);
      expect(await store.getEnvelopeByIdForUser('env-1', 'user-2')).toBeNull();
      expect(await store.getEnvelopeByIdForUser('nope', 'user-1')).toBeNull();
    });
  });

  describe('getEnvelopeById / getEnvelopeByProviderEnvelopeId', () => {
    it('finds by internal id and by provider id, null otherwise', async () => {
      const store = createMemoryEnvelopeStore();
      await seed(store, 'env-1');
      await seed(store, 'env-2');
      expect((await store.getEnvelopeById('env-2'))?.providerEnvelopeId).toBe(
        'ds-env-2',
      );
      expect(await store.getEnvelopeById('env-3')).toBeNull();
      expect(
        (await store.getEnvelopeByProviderEnvelopeId('ds-env-2'))?.id,
      ).toBe('env-2');
      expect(
        await store.getEnvelopeByProviderEnvelopeId('ds-env-3'),
      ).toBeNull();
      expect(
        await createMemoryEnvelopeStore().getEnvelopeByProviderEnvelopeId('x'),
      ).toBeNull();
    });
  });

  describe('updateEnvelopeStatus', () => {
    it('updates the status and updatedAt, keeping createdAt', async () => {
      const store = createMemoryEnvelopeStore(ticking());
      const created = await seed(store);
      const updated = await store.updateEnvelopeStatus('env-1', 'completed');
      expect(updated.status).toBe('completed');
      expect(updated.createdAt).toEqual(created.createdAt);
      expect(updated.updatedAt.getTime()).toBeGreaterThan(
        created.updatedAt.getTime(),
      );
      expect(await store.getEnvelopeById('env-1')).toEqual(updated);
      updated.status = 'voided';
      expect((await store.getEnvelopeById('env-1'))?.status).toBe('completed');
    });

    it('throws for an unknown envelope', async () => {
      const store = createMemoryEnvelopeStore();
      await expect(
        store.updateEnvelopeStatus('missing', 'completed'),
      ).rejects.toThrow('Envelope not found: missing');
    });
  });

  describe('audit entries', () => {
    it('lists entries newest first, filtered per envelope, as copies', async () => {
      const store = createMemoryEnvelopeStore(ticking());
      await store.appendAuditEntry({
        id: 'a1',
        envelopeId: 'env-1',
        action: 'initiated',
        metadata: { contractType: 'nda' },
      });
      await store.appendAuditEntry({
        id: 'a2',
        envelopeId: 'env-2',
        action: 'initiated',
        metadata: {},
      });
      await store.appendAuditEntry({
        id: 'a3',
        envelopeId: 'env-1',
        action: 'completed',
        metadata: { source: 'webhook' },
      });

      const entries = await store.listAuditEntries('env-1');
      expect(entries.map(entry => entry.id)).toEqual(['a3', 'a1']);
      expect(entries[0]).toEqual({
        id: 'a3',
        envelopeId: 'env-1',
        action: 'completed',
        metadata: { source: 'webhook' },
        timestamp: expect.any(Date),
      });
      expect(entries[0].timestamp.getTime()).toBeGreaterThan(
        entries[1].timestamp.getTime(),
      );
      expect(await store.listAuditEntries('env-3')).toEqual([]);

      entries[0].action = 'tampered';
      expect((await store.listAuditEntries('env-1'))[0].action).toBe(
        'completed',
      );
    });
  });

  describe('transaction', () => {
    it('commits the writes and returns the callback result on success', async () => {
      const store = createMemoryEnvelopeStore();
      const result = await store.transaction(async tx => {
        const record = await seed(tx);
        await tx.appendAuditEntry({
          id: 'a1',
          envelopeId: record.id,
          action: 'initiated',
          metadata: {},
        });
        return record.id;
      });
      expect(result).toBe('env-1');
      expect(await store.getEnvelopeById('env-1')).not.toBeNull();
      expect(await store.listAuditEntries('env-1')).toHaveLength(1);
    });

    it('restores both tables and rethrows when the callback throws', async () => {
      const store = createMemoryEnvelopeStore();
      await seed(store, 'env-0');
      await store.appendAuditEntry({
        id: 'a0',
        envelopeId: 'env-0',
        action: 'initiated',
        metadata: {},
      });

      await expect(
        store.transaction(async tx => {
          await seed(tx, 'env-1');
          await tx.updateEnvelopeStatus('env-0', 'completed');
          await tx.appendAuditEntry({
            id: 'a1',
            envelopeId: 'env-1',
            action: 'initiated',
            metadata: {},
          });
          throw new Error('rollback me');
        }),
      ).rejects.toThrow('rollback me');

      expect(await store.getEnvelopeById('env-1')).toBeNull();
      expect((await store.getEnvelopeById('env-0'))?.status).toBe('sent');
      expect(await store.listAuditEntries('env-1')).toEqual([]);
      expect(await store.listAuditEntries('env-0')).toHaveLength(1);

      // The store keeps working after a rollback
      await seed(store, 'env-2');
      expect(await store.getEnvelopeById('env-2')).not.toBeNull();
    });
  });
});
