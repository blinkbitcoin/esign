import { spyLogger } from './support';
import { createEnvelopeService, type EnvelopeServiceDeps } from '../envelopes';
import { Errors } from '../errors';
import type { Logger } from '../log';
import type { ESignProvider } from '../provider';
import { createMemoryEnvelopeStore, type EnvelopeStore } from '../store';
import type { SpanAttributes, Tracing } from '../tracing';
import type { EnvelopeStatus, WebhookEvent } from '../types';

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const recipient = { name: 'Jane Signer', email: 'jane@example.com' };

const fakeLogger = spyLogger;

const fakeProvider = () => ({
  createEnvelope: jest.fn(async () => ({
    envelopeId: 'ds-provider-id',
    signingUrl: 'https://docusign.example/sign',
  })),
  getEnvelopeStatus: jest.fn(async (): Promise<EnvelopeStatus> => 'sent'),
  getSigningUrl: jest.fn(async () => ({
    signingUrl: 'https://docusign.example/sign?restart',
  })),
  verifyWebhook: jest.fn(() => true),
  parseWebhookEvent: jest.fn(() => null),
});

// Deterministic ids: id-1, id-2, ...
const counter = () => {
  let n = 0;
  return () => `id-${++n}`;
};

const setup = (overrides: Partial<EnvelopeServiceDeps> = {}) => {
  const provider = fakeProvider();
  const store = createMemoryEnvelopeStore();
  const logger = fakeLogger();
  const service = createEnvelopeService({
    provider: provider as ESignProvider,
    store,
    logger,
    newId: counter(),
    ...overrides,
  });
  return { service, provider, store, logger };
};

// A service with one 'sent' envelope owned by user-1 (internal id id-1,
// provider id ds-provider-id, 'initiated' audit entry id-2)
const withEnvelope = async (overrides: Partial<EnvelopeServiceDeps> = {}) => {
  const ctx = setup(overrides);
  const created = await ctx.service.createEnvelope('user-1', {
    contractType: 'nda',
    recipient,
  });
  return { ...ctx, envelopeId: created.envelopeId };
};

const webhook = (
  status: WebhookEvent['status'],
  providerEnvelopeId = 'ds-provider-id',
  rawStatus = status ?? 'unknown',
): WebhookEvent => ({ providerEnvelopeId, status, rawStatus });

describe('createEnvelopeService', () => {
  describe('authorization', () => {
    it('rejects every operation without a user, before touching provider or store', async () => {
      const { service, provider, store } = setup();
      const spy = jest.spyOn(store, 'getEnvelopeByIdForUser');
      const unauthorized = expect.objectContaining({
        code: 'UNAUTHORIZED',
        message: 'Authentication required',
      });

      await expect(
        service.createEnvelope(null, { contractType: 'nda', recipient }),
      ).rejects.toEqual(unauthorized);
      await expect(
        service.getSigningUrl(null, { envelopeId: 'id-2', recipient }),
      ).rejects.toEqual(unauthorized);
      await expect(service.getEnvelope(null, 'id-2')).rejects.toEqual(
        unauthorized,
      );
      await expect(service.getAuditLogs(null, 'id-2')).rejects.toEqual(
        unauthorized,
      );
      await expect(service.getEnvelope('', 'id-2')).rejects.toEqual(
        unauthorized,
      );

      expect(provider.createEnvelope).not.toHaveBeenCalled();
      expect(provider.getSigningUrl).not.toHaveBeenCalled();
      expect(spy).not.toHaveBeenCalled();
    });
  });

  describe('createEnvelope', () => {
    it('validates the contract type and recipient before calling the provider', async () => {
      const { service, provider } = setup();
      const cases: [Parameters<typeof service.createEnvelope>[1], string][] = [
        [
          { contractType: '', recipient },
          'contractType is required and cannot be empty',
        ],
        [
          { contractType: 'x'.repeat(101), recipient },
          'contractType must be at most 100 characters',
        ],
        [
          { contractType: 'nda', recipient: { ...recipient, name: ' ' } },
          'recipient.name is required and cannot be empty',
        ],
        [
          {
            contractType: 'nda',
            recipient: { ...recipient, name: 'n'.repeat(201) },
          },
          'recipient.name must be at most 200 characters',
        ],
        [
          { contractType: 'nda', recipient: { ...recipient, email: 'nope' } },
          'recipient.email must be a valid email address',
        ],
      ];
      for (const [input, message] of cases) {
        await expect(service.createEnvelope('user-1', input)).rejects.toEqual(
          expect.objectContaining({ code: 'VALIDATION_ERROR', message }),
        );
      }
      expect(provider.createEnvelope).not.toHaveBeenCalled();
    });

    it('returns the INTERNAL id, never the provider id, and records the audit trail atomically', async () => {
      const { service, provider, store } = setup();

      const result = await service.createEnvelope('user-1', {
        contractType: 'nda',
        recipient,
      });

      expect(provider.createEnvelope).toHaveBeenCalledWith(
        'user-1',
        'nda',
        recipient,
      );
      expect(result).toEqual({
        envelopeId: 'id-1',
        signingUrl: 'https://docusign.example/sign',
      });
      expect(result.envelopeId).not.toBe('ds-provider-id');
      expect(JSON.stringify(result)).not.toContain('ds-provider-id');

      const stored = await store.getEnvelopeById('id-1');
      expect(stored).toMatchObject({
        id: 'id-1',
        providerEnvelopeId: 'ds-provider-id',
        userId: 'user-1',
        contractType: 'nda',
        status: 'sent',
      });

      const audit = await store.listAuditEntries('id-1');
      expect(audit).toEqual([
        {
          id: 'id-2',
          envelopeId: 'id-1',
          action: 'initiated',
          metadata: { contractType: 'nda', userId: 'user-1' },
          timestamp: expect.any(Date),
        },
      ]);
      // No PII reaches the audit trail
      expect(JSON.stringify(audit)).not.toContain('jane@example.com');
      expect(JSON.stringify(audit)).not.toContain('Jane Signer');
    });

    it('logs a PII-free failure record and rethrows when the provider fails', async () => {
      const { service, provider, store, logger } = setup();
      const failure = Errors.providerUnavailable();
      provider.createEnvelope.mockRejectedValueOnce(failure);
      const createSpy = jest.spyOn(store, 'createEnvelope');

      await expect(
        service.createEnvelope('user-1', { contractType: 'nda', recipient }),
      ).rejects.toBe(failure);

      expect(logger.error).toHaveBeenCalledWith('Envelope creation failed:', {
        action: 'creation_failed',
        errorCode: 'PROVIDER_UNAVAILABLE',
        contractType: 'nda',
        userId: 'user-1',
        timestamp: expect.any(String),
      });
      expect(JSON.stringify(logger.error.mock.calls)).not.toContain(
        'jane@example.com',
      );
      expect(createSpy).not.toHaveBeenCalled();
    });

    it('maps a rejected transaction to PERSISTENCE_FAILED and leaves nothing behind', async () => {
      const { service, store, logger } = setup();
      jest
        .spyOn(store, 'transaction')
        .mockRejectedValueOnce(new Error('connection lost'));

      await expect(
        service.createEnvelope('user-1', { contractType: 'nda', recipient }),
      ).rejects.toEqual(
        expect.objectContaining({
          code: 'PERSISTENCE_FAILED',
          message: 'Failed to save envelope data',
        }),
      );
      expect(logger.error).toHaveBeenCalledWith(
        'Failed to persist envelope:',
        'connection lost',
      );
      expect(await store.getEnvelopeById('id-1')).toBeNull();
    });

    it('rolls back the envelope when the audit write fails inside the transaction', async () => {
      const { service, store, logger } = setup();
      jest.spyOn(store, 'appendAuditEntry').mockRejectedValueOnce('disk full');

      await expect(
        service.createEnvelope('user-1', { contractType: 'nda', recipient }),
      ).rejects.toMatchObject({ code: 'PERSISTENCE_FAILED' });

      // A non-Error rejection is logged as-is
      expect(logger.error).toHaveBeenCalledWith(
        'Failed to persist envelope:',
        'disk full',
      );
      expect(await store.getEnvelopeById('id-1')).toBeNull();
      expect(await store.listAuditEntries('id-1')).toEqual([]);
    });
  });

  describe('getSigningUrl', () => {
    it('validates the envelope id and recipient', async () => {
      const { service } = await withEnvelope();
      await expect(
        service.getSigningUrl('user-1', { envelopeId: '', recipient }),
      ).rejects.toEqual(
        expect.objectContaining({
          code: 'VALIDATION_ERROR',
          message: 'envelopeId is required and cannot be empty',
        }),
      );
      await expect(
        service.getSigningUrl('user-1', {
          envelopeId: 'id-2',
          recipient: { ...recipient, email: 'bad' },
        }),
      ).rejects.toEqual(
        expect.objectContaining({
          code: 'VALIDATION_ERROR',
          message: 'recipient.email must be a valid email address',
        }),
      );
    });

    it('hides envelopes of other users and unknown ids behind ENVELOPE_NOT_FOUND', async () => {
      const { service, provider, envelopeId } = await withEnvelope();
      const notFound = expect.objectContaining({
        code: 'ENVELOPE_NOT_FOUND',
        message: 'Envelope not found',
      });
      await expect(
        service.getSigningUrl('user-2', { envelopeId, recipient }),
      ).rejects.toEqual(notFound);
      await expect(
        service.getSigningUrl('user-1', { envelopeId: 'nope', recipient }),
      ).rejects.toEqual(notFound);
      expect(provider.getSigningUrl).not.toHaveBeenCalled();
    });

    it.each(['completed', 'voided', 'declined'] as const)(
      'refuses to restart a %s envelope',
      async status => {
        const { service, store, provider, envelopeId } = await withEnvelope();
        await store.updateEnvelopeStatus(envelopeId, status);
        await expect(
          service.getSigningUrl('user-1', { envelopeId, recipient }),
        ).rejects.toEqual(
          expect.objectContaining({
            code: 'VALIDATION_ERROR',
            message: 'Cannot restart signing for completed or voided envelope',
          }),
        );
        expect(provider.getSigningUrl).not.toHaveBeenCalled();
      },
    );

    it('asks the provider by provider id and records a session_restart', async () => {
      const { service, store, provider, envelopeId } = await withEnvelope();

      const result = await service.getSigningUrl('user-1', {
        envelopeId,
        recipient,
      });

      expect(result).toEqual({
        signingUrl: 'https://docusign.example/sign?restart',
      });
      expect(provider.getSigningUrl).toHaveBeenCalledWith(
        'ds-provider-id',
        recipient,
      );
      const audit = await store.listAuditEntries(envelopeId);
      expect(audit.map(entry => entry.action)).toEqual([
        'session_restart',
        'initiated',
      ]);
      expect(audit[0]).toMatchObject({
        id: 'id-3',
        metadata: { userId: 'user-1' },
      });
    });
  });

  describe('getEnvelope', () => {
    it('returns only id, status, contractType and createdAt', async () => {
      const { service, store, envelopeId } = await withEnvelope();
      const stored = await store.getEnvelopeById(envelopeId);
      const view = await service.getEnvelope('user-1', envelopeId);
      expect(view).toEqual({
        id: envelopeId,
        status: 'sent',
        contractType: 'nda',
        createdAt: stored?.createdAt,
      });
      expect(Object.keys(view).sort()).toEqual([
        'contractType',
        'createdAt',
        'id',
        'status',
      ]);
      expect(JSON.stringify(view)).not.toContain('ds-provider-id');
    });

    it('requires an id and enforces ownership', async () => {
      const { service, envelopeId } = await withEnvelope();
      await expect(service.getEnvelope('user-1', '')).rejects.toEqual(
        expect.objectContaining({
          code: 'VALIDATION_ERROR',
          message: 'id is required and cannot be empty',
        }),
      );
      await expect(service.getEnvelope('user-2', envelopeId)).rejects.toEqual(
        expect.objectContaining({ code: 'ENVELOPE_NOT_FOUND' }),
      );
    });
  });

  describe('getAuditLogs', () => {
    it('lists the owner-visible trail newest first without provider ids', async () => {
      const { service, envelopeId } = await withEnvelope();
      await service.getSigningUrl('user-1', { envelopeId, recipient });

      const logs = await service.getAuditLogs('user-1', envelopeId);
      expect(logs.map(entry => entry.action)).toEqual([
        'session_restart',
        'initiated',
      ]);
      expect(logs[0].timestamp.getTime()).toBeGreaterThanOrEqual(
        logs[1].timestamp.getTime(),
      );
      expect(JSON.stringify(logs)).not.toContain('ds-provider-id');
    });

    it('requires an envelope id and enforces ownership', async () => {
      const { service, envelopeId } = await withEnvelope();
      await expect(service.getAuditLogs('user-1', ' ')).rejects.toEqual(
        expect.objectContaining({
          code: 'VALIDATION_ERROR',
          message: 'envelopeId is required and cannot be empty',
        }),
      );
      await expect(service.getAuditLogs('user-2', envelopeId)).rejects.toEqual(
        expect.objectContaining({ code: 'ENVELOPE_NOT_FOUND' }),
      );
    });
  });

  describe('handleWebhookEvent', () => {
    it('ignores an event with an unknown status, sanitizing the raw status in the log', async () => {
      const { service, logger, store } = await withEnvelope();
      const outcome = await service.handleWebhookEvent(
        webhook(null, 'ds-provider-id', 'weird\r\nstatus'),
      );
      expect(outcome).toBe('ignored_unknown_status');
      expect(logger.warn).toHaveBeenCalledWith(
        'Webhook received with unknown status: weird��status for envelope ds-provider-id',
      );
      expect((await store.getEnvelopeById('id-1'))?.status).toBe('sent');
    });

    it('acknowledges an event for an unknown envelope', async () => {
      const { service, logger } = await withEnvelope();
      const outcome = await service.handleWebhookEvent(
        webhook('completed', 'ds-other\n'),
      );
      expect(outcome).toBe('unknown_envelope');
      expect(logger.warn).toHaveBeenCalledWith(
        'Webhook received for unknown envelope: ds-other�',
      );
    });

    it('is idempotent: a repeated status changes nothing and writes no audit entry', async () => {
      const { service, store, logger, envelopeId } = await withEnvelope();
      expect(await service.handleWebhookEvent(webhook('sent'))).toBe(
        'unchanged',
      );
      expect(await store.listAuditEntries(envelopeId)).toHaveLength(1);
      expect(logger.log).toHaveBeenCalledWith(
        `Idempotent: envelope ${envelopeId} already has status sent`,
      );

      expect(await service.handleWebhookEvent(webhook('completed'))).toBe(
        'updated',
      );
      expect(await service.handleWebhookEvent(webhook('completed'))).toBe(
        'unchanged',
      );
      expect(await store.listAuditEntries(envelopeId)).toHaveLength(2);
    });

    it.each(['completed', 'voided', 'declined'] as const)(
      'updates a sent envelope to %s with a webhook-sourced audit entry',
      async status => {
        const { service, store, logger, envelopeId } = await withEnvelope();

        expect(await service.handleWebhookEvent(webhook(status))).toBe(
          'updated',
        );

        expect((await store.getEnvelopeById(envelopeId))?.status).toBe(status);
        const audit = await store.listAuditEntries(envelopeId);
        expect(audit[0]).toEqual({
          id: 'id-3',
          envelopeId,
          action: status,
          metadata: { source: 'webhook' },
          timestamp: expect.any(Date),
        });
        expect(logger.log).toHaveBeenCalledWith(
          `Webhook processed: envelope ${envelopeId} status updated to ${status}`,
        );
      },
    );

    it.each([
      ['completed', 'sent'],
      ['completed', 'voided'],
      ['voided', 'completed'],
      ['declined', 'sent'],
    ] as const)(
      'refuses to move a %s envelope to %s (replay-downgrade guard)',
      async (terminal, next) => {
        const { service, store, logger, envelopeId } = await withEnvelope();
        await store.updateEnvelopeStatus(envelopeId, terminal);

        expect(await service.handleWebhookEvent(webhook(next))).toBe(
          'rejected_terminal',
        );

        expect((await store.getEnvelopeById(envelopeId))?.status).toBe(
          terminal,
        );
        expect(await store.listAuditEntries(envelopeId)).toHaveLength(1);
        expect(logger.warn).toHaveBeenCalledWith(
          `Webhook ignored: envelope ${envelopeId} is in terminal status ${terminal}, refusing transition to ${next}`,
        );
      },
    );

    it('refuses a webhook carrying sent before any write: no status change, no audit entry', async () => {
      const { service, store, logger, envelopeId } = await withEnvelope();
      // The only non-terminal status is sent, so reaching the transition
      // with a sent webhook takes an envelope in a status the table does
      // not know (what a future status would look like before it is mapped)
      await store.updateEnvelopeStatus(envelopeId, 'pending' as EnvelopeStatus);
      const appendAuditEntry = jest.spyOn(store, 'appendAuditEntry');
      const transaction = jest.spyOn(store, 'transaction');

      expect(await service.handleWebhookEvent(webhook('sent'))).toBe(
        'rejected_no_transition',
      );

      expect(transaction).not.toHaveBeenCalled();
      expect(appendAuditEntry).not.toHaveBeenCalled();
      expect((await store.getEnvelopeById(envelopeId))?.status).toBe('pending');
      expect(await store.listAuditEntries(envelopeId)).toHaveLength(1);
      expect(logger.warn).toHaveBeenCalledWith(
        `Webhook ignored: sent is not a transition for envelope ${envelopeId}`,
      );
    });

    it('rolls back the status when the audit write fails', async () => {
      const { service, store, envelopeId } = await withEnvelope();
      jest
        .spyOn(store, 'appendAuditEntry')
        .mockRejectedValueOnce(new Error('disk full'));
      await expect(
        service.handleWebhookEvent(webhook('completed')),
      ).rejects.toThrow('disk full');
      expect((await store.getEnvelopeById(envelopeId))?.status).toBe('sent');
    });

    it('reports the span with envelope attributes and the outcome', async () => {
      const spans: { name: string; attributes: SpanAttributes }[] = [];
      const set: [string, string | number | boolean][] = [];
      const tracing: Tracing = {
        withSpan: (name, attributes, fn) => {
          spans.push({ name, attributes });
          return fn({ setAttribute: (key, value) => set.push([key, value]) });
        },
      };
      const { service } = await withEnvelope({ tracing });

      await service.handleWebhookEvent(
        webhook('completed', 'ds-provider-id', 'Completed'),
      );

      expect(spans).toEqual([
        {
          name: 'esign.webhook.process',
          attributes: {
            'esign.provider_envelope_id': 'ds-provider-id',
            'esign.webhook.raw_status': 'Completed',
          },
        },
      ]);
      expect(set).toEqual([
        ['esign.webhook.status', 'completed'],
        ['esign.envelope_id', 'id-1'],
        ['esign.webhook.outcome', 'updated'],
      ]);

      set.length = 0;
      await service.handleWebhookEvent(webhook(null));
      expect(set).toEqual([
        ['esign.webhook.outcome', 'ignored_unknown_status'],
      ]);
    });
  });

  describe('defaults', () => {
    it('logs through console, generates UUIDs and traces nothing when nothing is injected', async () => {
      const log = jest.spyOn(console, 'log').mockImplementation(() => {});
      const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
      const error = jest.spyOn(console, 'error').mockImplementation(() => {});
      const provider = fakeProvider();
      const store = createMemoryEnvelopeStore();
      const service = createEnvelopeService({
        provider: provider as ESignProvider,
        store,
      });

      const created = await service.createEnvelope('user-1', {
        contractType: 'nda',
        recipient,
      });
      expect(created.envelopeId).toMatch(UUID);
      expect((await store.listAuditEntries(created.envelopeId))[0].id).toMatch(
        UUID,
      );

      expect(await service.handleWebhookEvent(webhook('sent'))).toBe(
        'unchanged',
      );
      expect(log).toHaveBeenCalledWith(
        expect.stringContaining('Idempotent: envelope'),
      );
      expect(await service.handleWebhookEvent(webhook(null))).toBe(
        'ignored_unknown_status',
      );
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining('Webhook received with unknown status'),
      );

      provider.createEnvelope.mockRejectedValueOnce(new Error('down'));
      await expect(
        service.createEnvelope('user-1', { contractType: 'nda', recipient }),
      ).rejects.toThrow('down');
      expect(error).toHaveBeenCalledWith(
        'Envelope creation failed:',
        expect.objectContaining({ errorCode: 'UNKNOWN_ERROR' }),
      );

      log.mockRestore();
      warn.mockRestore();
      error.mockRestore();
    });

    it('works with a custom logger only (default tracing and ids)', async () => {
      const logger: Logger = fakeLogger();
      const store: EnvelopeStore = createMemoryEnvelopeStore();
      const service = createEnvelopeService({
        provider: fakeProvider() as ESignProvider,
        store,
        logger,
      });
      const created = await service.createEnvelope('user-1', {
        contractType: 'nda',
        recipient,
      });
      expect(created.envelopeId).toMatch(UUID);
    });
  });
});
