// The GraphQL layer: resolvers map onto the envelope service and never leak
// the provider's id; the SDL is the client contract.

import { silentLogger } from './support';
import { createEnvelopeService } from '../envelopes';
import { createESignGraphQL, typeDefs } from '../graphql';
import type { ESignProvider } from '../provider';
import { createMemoryEnvelopeStore } from '../store';

const provider: ESignProvider = {
  createEnvelope: jest
    .fn()
    .mockResolvedValue({ envelopeId: 'ds-1', signingUrl: 'https://sign/1' }),
  getEnvelopeStatus: jest.fn(),
  getSigningUrl: jest
    .fn()
    .mockResolvedValue({ signingUrl: 'https://sign/again' }),
  verifyWebhook: jest.fn(),
  parseWebhookEvent: jest.fn(),
};

const setup = () => {
  const store = createMemoryEnvelopeStore(
    () => new Date('2026-09-08T10:00:00Z'),
  );
  const envelopes = createEnvelopeService({
    provider,
    store,
    newId: () => 'fixed-id',
    logger: silentLogger,
  });
  const { resolvers } = createESignGraphQL({
    envelopes,
    now: () => new Date('2026-09-08T12:00:00Z'),
  });
  return { store, resolvers };
};

const user = { userId: 'user-1' };
const input = {
  contractType: 'loan',
  recipient: { name: 'Jane', email: 'jane@example.com' },
};

describe('createESignGraphQL', () => {
  it('exposes the SDL with the ErrorCode contract', () => {
    const { resolvers } = setup();
    expect(
      createESignGraphQL({
        envelopes: createEnvelopeService({
          provider,
          store: createMemoryEnvelopeStore(),
        }),
      }).typeDefs,
    ).toBe(typeDefs);
    expect(typeDefs).toContain('enum ErrorCode');
    expect(typeDefs).not.toContain('providerEnvelopeId:');
    expect(typeof resolvers.Query.health).toBe('function');
  });

  it('health reports ok with the injected clock, and a real clock by default', () => {
    const { resolvers } = setup();
    expect(resolvers.Query.health()).toEqual({
      status: 'ok',
      timestamp: '2026-09-08T12:00:00.000Z',
    });
    const defaults = createESignGraphQL({
      envelopes: createEnvelopeService({
        provider,
        store: createMemoryEnvelopeStore(),
      }),
    });
    expect(typeof defaults.resolvers.Query.health().timestamp).toBe('string');
  });

  it('createEnvelope returns the internal id, envelope exposes safe fields only', async () => {
    const { resolvers } = setup();
    const created = await resolvers.Mutation.createEnvelope(
      undefined,
      { input },
      user,
    );
    expect(created).toEqual({
      envelopeId: 'fixed-id',
      signingUrl: 'https://sign/1',
    });

    const view = await resolvers.Query.envelope(
      undefined,
      { id: 'fixed-id' },
      user,
    );
    expect(view).toEqual({
      id: 'fixed-id',
      status: 'sent',
      contractType: 'loan',
      createdAt: '2026-09-08T10:00:00.000Z',
    });
    expect(JSON.stringify(view)).not.toContain('ds-1');
  });

  it('auditLogs serialises metadata as JSON, null when absent', async () => {
    const { store, resolvers } = setup();
    await resolvers.Mutation.createEnvelope(undefined, { input }, user);
    await store.appendAuditEntry({
      id: 'a-null',
      envelopeId: 'fixed-id',
      action: 'failed',
      metadata: null as unknown as Record<string, unknown>,
    });
    const logs = await resolvers.Query.auditLogs(
      undefined,
      { envelopeId: 'fixed-id' },
      user,
    );
    expect(logs).toEqual([
      {
        id: 'a-null',
        action: 'failed',
        timestamp: '2026-09-08T10:00:00.000Z',
        metadata: null,
      },
      {
        id: 'fixed-id',
        action: 'initiated',
        timestamp: '2026-09-08T10:00:00.000Z',
        metadata: JSON.stringify({ contractType: 'loan', userId: 'user-1' }),
      },
    ]);
  });

  it('getSigningUrl delegates the restart to the service', async () => {
    const { resolvers } = setup();
    await resolvers.Mutation.createEnvelope(undefined, { input }, user);
    await expect(
      resolvers.Mutation.getSigningUrl(
        undefined,
        { input: { envelopeId: 'fixed-id', recipient: input.recipient } },
        user,
      ),
    ).resolves.toEqual({ signingUrl: 'https://sign/again' });
    expect(provider.getSigningUrl).toHaveBeenCalledWith(
      'ds-1',
      input.recipient,
    );
  });

  it('surfaces the service errors with their codes', async () => {
    const { resolvers } = setup();
    await expect(
      resolvers.Query.envelope(undefined, { id: 'x' }, { userId: null }),
    ).rejects.toMatchObject({
      extensions: { code: 'UNAUTHORIZED' },
    });
    await expect(
      resolvers.Query.auditLogs(undefined, { envelopeId: 'nope' }, user),
    ).rejects.toMatchObject({
      extensions: { code: 'ENVELOPE_NOT_FOUND' },
    });
  });
});
