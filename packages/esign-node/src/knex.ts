// @blinkbitcoin/esign-node/knex - the Postgres side for hosts that keep
// envelopes in their own database: the Knex implementation of the
// EnvelopeStore port and the schema it needs as a programmatic migration
// source. The host passes its own Knex instance; `knex` is an optional peer
// for the types only (nothing from it is imported at runtime).

export {
  createESignMigrationSource,
  ESIGN_MIGRATIONS,
  type ESignMigration,
  runESignMigrations,
} from './knex/migrations';
export {
  createKnexEnvelopeStore,
  type KnexEnvelopeStoreOptions,
} from './knex/store';
