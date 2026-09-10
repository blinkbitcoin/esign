import { vi } from 'vitest';

const createKnexClient = vi.fn((env: Record<string, string | undefined>) => ({
  fake: env.DATABASE_URL,
}));
vi.mock('../src/db', () => ({
  DATABASE_URL: 'DATABASE_URL',
  createKnexClient: (env: Record<string, string | undefined>) => createKnexClient(env),
}));
vi.mock('@blinkbitcoin/esign-node/knex', () => ({
  createKnexEnvelopeStore: vi.fn((knex: unknown) => ({ composed: knex })),
}));

describe('createStore', () => {
  it('is the package Knex store over a client built from the env it was given', async () => {
    const { createKnexEnvelopeStore } = await import('@blinkbitcoin/esign-node/knex');
    const { createStore } = await import('../src/store');

    const store = createStore({ DATABASE_URL: 'postgres://injected@host/db' });

    expect(createKnexClient).toHaveBeenCalledWith({
      DATABASE_URL: 'postgres://injected@host/db',
    });
    expect(createKnexEnvelopeStore).toHaveBeenCalledWith({
      fake: 'postgres://injected@host/db',
    });
    expect(store).toEqual({ composed: { fake: 'postgres://injected@host/db' } });
  });
});
