import createKnex, { Knex } from 'knex';

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL environment variable is required');
}

const knexConfig: Knex.Config = {
  client: 'pg',
  connection: process.env.DATABASE_URL,
};

export const knex = createKnex(knexConfig);
