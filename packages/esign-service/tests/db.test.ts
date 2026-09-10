import { vi } from 'vitest';

vi.unmock('../src/db');

import { createKnexClient } from '../src/db';

const TEST_URL = 'postgresql://test:test@localhost:5433/esign_test';

describe('createKnexClient', () => {
  it('refuses an env without DATABASE_URL, naming the variable', () => {
    expect(() => createKnexClient({})).toThrow('DATABASE_URL environment variable is required');
    expect(() => createKnexClient({ DATABASE_URL: '' })).toThrow(
      'DATABASE_URL environment variable is required'
    );
  });

  it('connects to the injected env, not to process.env', async () => {
    // process.env points somewhere else entirely: a client built from it
    // would connect to the wrong database and the test would not notice
    const original = process.env.DATABASE_URL;
    process.env.DATABASE_URL = 'postgresql://wrong:wrong@elsewhere:9999/wrong';
    try {
      const knex = createKnexClient({ DATABASE_URL: TEST_URL });

      expect(knex.client.config.client).toBe('pg');
      expect(knex.client.connectionSettings).toMatchObject({
        host: 'localhost',
        port: '5433',
        database: 'esign_test',
        user: 'test',
      });
      await knex.destroy();
    } finally {
      if (original === undefined) {
        delete process.env.DATABASE_URL;
      } else {
        process.env.DATABASE_URL = original;
      }
    }
  });

  it('falls back to process.env for the entries that have no env of their own', async () => {
    const original = process.env.DATABASE_URL;
    process.env.DATABASE_URL = TEST_URL;
    try {
      const knex = createKnexClient();

      expect(knex.client.connectionSettings).toMatchObject({
        database: 'esign_test',
      });
      await knex.destroy();
    } finally {
      if (original === undefined) {
        delete process.env.DATABASE_URL;
      } else {
        process.env.DATABASE_URL = original;
      }
    }
  });
});
