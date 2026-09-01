// Tests for the real db module (tests/setup.ts auto-mocks it for every other
// test file). Creating a knex instance does not open a connection - pg pools
// lazily on first query - so this is safe without a running database.

import { vi } from 'vitest';

vi.unmock('../src/db');

describe('db', () => {
  const originalDatabaseUrl = process.env.DATABASE_URL;

  afterEach(() => {
    if (originalDatabaseUrl !== undefined) {
      process.env.DATABASE_URL = originalDatabaseUrl;
    } else {
      delete process.env.DATABASE_URL;
    }
    vi.resetModules();
  });

  it('throws at import time when DATABASE_URL is not set (fail-fast)', async () => {
    delete process.env.DATABASE_URL;
    vi.resetModules();

    await expect(import('../src/db')).rejects.toThrow(
      'DATABASE_URL environment variable is required'
    );
  });

  it('exports a pg-backed knex instance when DATABASE_URL is set', async () => {
    process.env.DATABASE_URL = 'postgresql://test:test@localhost:5433/esign_test';
    vi.resetModules();

    const { knex } = await import('../src/db');

    expect(knex.client.config.client).toBe('pg');
    // knex parses the connection string into its component fields
    expect(knex.client.connectionSettings).toMatchObject({
      host: 'localhost',
      port: '5433',
      database: 'esign_test',
      user: 'test',
    });

    // Clean up the (never-connected) pool so vitest can exit cleanly
    await knex.destroy();
  });
});
