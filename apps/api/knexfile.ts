// Load .env so `npm run migrate` works against the local dev database.
// dotenv never overrides variables that are already set, so explicit env
// (CI) and dotenv-cli wrappers (`npm run migrate:test` with .env.test)
// still take precedence.
import 'dotenv/config';

import type { Knex } from 'knex';

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL environment variable is required');
}

const config: Knex.Config = {
  client: 'pg',
  connection: process.env.DATABASE_URL,
  migrations: {
    tableName: 'knex_migrations',
    directory: './migrations',
    extension: 'ts',
  },
};

export default config;
