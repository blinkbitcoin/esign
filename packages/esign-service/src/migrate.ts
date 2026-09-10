// Applies the package's migrations to DATABASE_URL and exits. `npm run
// migrate` (tsx, loads .env) locally; `node dist/migrate.js` in the image.
import 'dotenv/config';

import { runESignMigrations } from '@blinkbitcoin/esign-node/knex';
import { createKnexClient } from './db';

const knex = createKnexClient();

runESignMigrations(knex)
  .then(async () => {
    console.log('Migrations applied.');
    await knex.destroy();
  })
  .catch(async (error) => {
    console.error('Migration failed:', error);
    await knex.destroy();
    process.exit(1);
  });
