import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  const hasEnvelopeTable = await knex.schema.hasTable('Envelope');

  if (!hasEnvelopeTable) {
    await knex.schema.createTable('Envelope', (table) => {
      table.text('id').primary();
      table.text('providerEnvelopeId').notNullable().unique();
      table.text('userId').notNullable();
      table.text('contractType').notNullable();
      table.text('status').notNullable();
      table.timestamp('createdAt', { precision: 3 }).notNullable().defaultTo(knex.fn.now());
      table.timestamp('updatedAt', { precision: 3 }).notNullable().defaultTo(knex.fn.now());
    });
    console.log('Envelope table created.');
  } else {
    console.log('Envelope table already exists, skipping table creation.');
  }

  const hasAuditLogTable = await knex.schema.hasTable('AuditLog');

  if (!hasAuditLogTable) {
    await knex.schema.createTable('AuditLog', (table) => {
      table.text('id').primary();
      table
        .text('envelopeId')
        .notNullable()
        .references('id')
        .inTable('Envelope')
        .onDelete('CASCADE');
      table.text('action').notNullable();
      table.timestamp('timestamp', { precision: 3 }).notNullable().defaultTo(knex.fn.now());
      table.jsonb('metadata');
    });
    console.log('AuditLog table created.');
  } else {
    console.log('AuditLog table already exists, skipping table creation.');
  }
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('AuditLog');
  await knex.schema.dropTableIfExists('Envelope');
  console.log('AuditLog and Envelope tables dropped.');
}
