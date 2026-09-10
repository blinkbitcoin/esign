// The service's envelope store: the package's Knex implementation over a
// client built from the env the app was handed (src/db.ts). Internal UUIDs
// only - providerEnvelopeId never leaves the store's callers.

import type { EnvelopeStore } from '@blinkbitcoin/esign-node';
import { createKnexEnvelopeStore } from '@blinkbitcoin/esign-node/knex';
import { createKnexClient } from './db';
import type { Env } from './env';

export const createStore = (env: Env = process.env): EnvelopeStore =>
  createKnexEnvelopeStore(createKnexClient(env));
