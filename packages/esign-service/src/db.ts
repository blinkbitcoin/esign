// The Knex client the envelope store runs on. A factory, not a module-level
// singleton: every other module in this service takes the `env` it was
// handed, and a client built from `process.env` at import time would quietly
// connect somewhere else than the env the app was constructed with.
//
// Only the envelope half reaches this module (src/envelopes.ts and the
// migrate entry), so a mint-only deployment never loads `pg`.

import createKnex, { type Knex } from 'knex';
import type { Env } from './env';

export const DATABASE_URL = 'DATABASE_URL';

export const createKnexClient = (env: Env = process.env): Knex => {
  const connection = env[DATABASE_URL];
  if (!connection) {
    throw new Error(`${DATABASE_URL} environment variable is required`);
  }
  return createKnex({ client: 'pg', connection });
};
