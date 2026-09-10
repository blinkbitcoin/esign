// The service's envelope store: the package's Knex implementation over the
// shared Knex client (src/db.ts). Internal UUIDs only - providerEnvelopeId
// never leaves the store's callers.

import type { EnvelopeStore } from '@blinkbitcoin/esign-node';
import { createKnexEnvelopeStore } from '@blinkbitcoin/esign-node/knex';
import { knex } from './db';

export const store: EnvelopeStore = createKnexEnvelopeStore(knex);
