// Mock knex client for tests that exercise the repository layer directly
// (envelope.ts, audit.ts). Backed by knex-mock-client so query builders
// behave like real knex, but hit an in-memory tracker instead of Postgres.

import createKnex from 'knex';
import { MockClient } from 'knex-mock-client';

export const knex = createKnex({ client: MockClient });
