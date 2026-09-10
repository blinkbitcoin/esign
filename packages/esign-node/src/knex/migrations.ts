// The schema the Knex store needs, as a programmatic Knex migration source:
// hosts run `db.migrate.latest({ migrationSource: createESignMigrationSource() })`
// (or `runESignMigrations(db)`) and need no migration files, no TypeScript
// loader and no knexfile. Migration names are stable so a database migrated
// from the original files keeps its knex_migrations history.

import type { Knex } from 'knex';

export interface ESignMigration {
  name: string;
  up(db: Knex): Promise<void>;
  down(db: Knex): Promise<void>;
}

const createEnvelopeAndAuditLogTables: ESignMigration = {
  name: '20260702083000_create_envelope_and_audit_log_tables.ts',
  async up(db) {
    if (!(await db.schema.hasTable('Envelope'))) {
      await db.schema.createTable('Envelope', table => {
        table.text('id').primary();
        table.text('providerEnvelopeId').notNullable().unique();
        table.text('userId').notNullable();
        table.text('contractType').notNullable();
        table.text('status').notNullable();
        table
          .timestamp('createdAt', { precision: 3 })
          .notNullable()
          .defaultTo(db.fn.now());
        table
          .timestamp('updatedAt', { precision: 3 })
          .notNullable()
          .defaultTo(db.fn.now());
      });
    }
    if (!(await db.schema.hasTable('AuditLog'))) {
      await db.schema.createTable('AuditLog', table => {
        table.text('id').primary();
        table
          .text('envelopeId')
          .notNullable()
          .references('id')
          .inTable('Envelope')
          .onDelete('CASCADE');
        table.text('action').notNullable();
        table
          .timestamp('timestamp', { precision: 3 })
          .notNullable()
          .defaultTo(db.fn.now());
        table.jsonb('metadata');
      });
    }
  },
  async down(db) {
    await db.schema.dropTableIfExists('AuditLog');
    await db.schema.dropTableIfExists('Envelope');
  },
};

// In order; append new migrations here, never edit a shipped one
export const ESIGN_MIGRATIONS: readonly ESignMigration[] = [
  createEnvelopeAndAuditLogTables,
];

export const createESignMigrationSource =
  (): Knex.MigrationSource<ESignMigration> => ({
    getMigrations: async () => [...ESIGN_MIGRATIONS],
    getMigrationName: migration => migration.name,
    getMigration: async migration => migration,
  });

// Applies every pending esign migration through the host's Knex instance
export const runESignMigrations = (db: Knex): Promise<unknown> =>
  db.migrate.latest({ migrationSource: createESignMigrationSource() });
