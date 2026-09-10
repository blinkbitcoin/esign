# Data Models - Backend

**Part:** backend
**Database:** PostgreSQL via Knex.js 3.3.x
**Updated:** 2026-07-02

## Overview

The backend uses two primary models for envelope management and audit tracking.
Schema and data access both come from `@blinkbitcoin/esign-node/knex`:
`ESIGN_MIGRATIONS` (a programmatic Knex migration source, no migration files
or knexfile in the service) and `createKnexEnvelopeStore`, the Knex
implementation of the `EnvelopeStore` port. The service composes the store
over its shared Knex instance in `src/store.ts` (`src/db.ts`) and applies the
migrations with `src/migrate.ts`. A host with its own Postgres uses the same
two exports.

## Entity Relationship Diagram

[![Database ERD](../diagrams/dist/database-erd.svg)](../diagrams/src/database-erd.mmd)

The `Envelope` → `AuditLog` relation is 1:N with `ON DELETE CASCADE`.

## Migrations

| Migration | Purpose |
|-----------|---------|
| `20260702083000_create_envelope_and_audit_log_tables` | Creates both tables: unique index on `providerEnvelopeId`, FK with cascade delete |

```typescript
// Shape of the created schema (from the initial migration)
await knex.schema.createTable('Envelope', (table) => {
  table.text('id').primary();
  table.text('providerEnvelopeId').notNullable().unique();
  table.text('userId').notNullable();
  table.text('contractType').notNullable();
  table.text('status').notNullable(); // sent, completed, voided, declined
  table.timestamp('createdAt', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  table.timestamp('updatedAt', { useTz: true }).notNullable().defaultTo(knex.fn.now());
});

await knex.schema.createTable('AuditLog', (table) => {
  table.text('id').primary();
  table
    .text('envelopeId')
    .notNullable()
    .references('id')
    .inTable('Envelope')
    .onDelete('CASCADE');
  table.text('action').notNullable();
  table.timestamp('timestamp', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  table.jsonb('metadata');
});
```

---

## Model: Envelope

Represents a signing envelope (contract document sent for signature).

### Fields

| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| `id` | UUID | PK, generated in app code | Internal envelope identifier - the only ID exposed to clients |
| `providerEnvelopeId` | String | Unique | E-sign provider's envelope ID (external) - **never exposed to clients** |
| `userId` | String | Required | Owner user ID (for access control) |
| `contractType` | String | Required | Type of contract (e.g., loan_agreement) |
| `status` | String | Required | Current envelope status |
| `createdAt` | DateTime | Default now() | Creation timestamp |
| `updatedAt` | DateTime | Set on update | Last update timestamp |

### Status Values

| Status | Description | Set By |
|--------|-------------|--------|
| `sent` | Awaiting signature | `createEnvelope` mutation |
| `completed` | Successfully signed | Webhook |
| `voided` | Cancelled by sender | Webhook |
| `declined` | Declined by recipient | Webhook |

### Indexes

| Index | Columns | Purpose |
|-------|---------|---------|
| Primary | `id` | Record lookup |
| Unique | `providerEnvelopeId` | Prevent duplicates, webhook lookup |
| (Recommended) | `userId` | User's envelope queries |

### Relationships

- **auditLogs**: One-to-many with AuditLog (cascade delete)

---

## Model: AuditLog

Tracks all actions performed on an envelope for compliance and debugging.
Metadata is sanitized at write time against an allow-list
(`contractType`, `userId`, `source`, `errorCode`) so PII can never leak in.

### Fields

| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| `id` | UUID | PK, generated in app code | Log entry identifier |
| `envelopeId` | UUID | FK → Envelope.id, CASCADE | Parent envelope |
| `action` | String | Required | Action type |
| `timestamp` | DateTime | Default now() | When action occurred |
| `metadata` | JSONB | Nullable | Sanitized context (no PII) |

### Action Values

| Action | Description | Metadata Example |
|--------|-------------|------------------|
| `initiated` | Envelope created (or re-sent via webhook) | `{ contractType, userId }` |
| `completed` | Signing completed | `{ source: "webhook" }` |
| `failed` | Operation failed | `{ errorCode }` |
| `voided` | Envelope voided | `{ source: "webhook" }` |
| `declined` | Signature declined | `{ source: "webhook" }` |
| `session_restart` | New signing URL issued for existing envelope | `{ userId }` |
| `creation_failed` | Provider envelope creation failed | `{ errorCode }` |

### Relationships

- **envelope**: Many-to-one with Envelope (ON DELETE CASCADE)

---

## The Store Port

Data access is not done inline in resolvers. The domain
(`createEnvelopeService` in `@blinkbitcoin/esign-node`) talks to an
`EnvelopeStore` port; `examples/full-service-demo/src/store.ts` implements it with Knex, and
the package ships an in-memory implementation for tests and for hosts that
keep envelope state elsewhere.

### Create Envelope with Audit Log (transactional)

```typescript
// envelopes.ts createEnvelope - every write through `tx` commits together
const created = await store.transaction(async (tx) => {
  const record = await tx.createEnvelope({ id, providerEnvelopeId, userId, contractType, status: 'sent' });
  await tx.appendAuditEntry({ id, envelopeId: record.id, action: 'initiated', metadata });
  return record;
});
```

### Find Envelope by Internal ID (Owner Scoped)

```typescript
// returns null on miss OR wrong owner (no info leak)
const envelope = await store.getEnvelopeByIdForUser(envelopeId, currentUserId);
```

### Find Envelope by Provider Envelope ID (Webhook)

```typescript
const envelope = await store.getEnvelopeByProviderEnvelopeId(providerEnvelopeId);
```

### Update Status with Audit Log (transactional)

```typescript
// envelopes.ts handleWebhookEvent
await store.transaction(async (tx) => {
  await tx.updateEnvelopeStatus(envelope.id, newStatus);
  await tx.appendAuditEntry({ id, envelopeId: envelope.id, action: newStatus, metadata: { source: 'webhook' } });
});
```

### Get Audit Logs for Envelope

```typescript
// newest first
const logs = await store.listAuditEntries(envelopeId);
```

---

## Migration Commands

The migrations live in the package
(`packages/esign-node/src/knex/migrations.ts`, `ESIGN_MIGRATIONS`, in
order; append, never edit a shipped one). Their names are the original file
names, so a database migrated before the move keeps its `knex_migrations`
history. Hosts run them through their own Knex instance:

```ts
import { runESignMigrations, createESignMigrationSource } from '@blinkbitcoin/esign-node/knex';
await runESignMigrations(db);                                          // migrate.latest
await db.migrate.rollback({ migrationSource: createESignMigrationSource() });
```

In this repo:

```bash
cd examples/full-service-demo
npm run migrate          # tsx src/migrate.ts against DATABASE_URL (.env)
npm run migrate:test     # the same against .env.test
# in the image: docker run --rm --env-file .env esign-api node dist/migrate.js
```

---

## Test Data Factory

```typescript
// examples/full-service-demo/tests/e2e/factories.ts (Knex-based, actual signatures)

export const createTestEnvelope = async (overrides = {}): Promise<Envelope> => {
  const [envelope] = await knex<Envelope>('Envelope')
    .insert({
      id: overrides.id ?? randomUUID(),
      providerEnvelopeId: overrides.providerEnvelopeId ?? `ds-${randomUUID()}`,
      userId: overrides.userId ?? 'test-user-123',
      contractType: overrides.contractType ?? 'loan_agreement',
      status: overrides.status ?? 'sent',
    })
    .returning('*');
  return envelope;
};

export const createTestAuditLog = async (envelopeId, overrides = {}) => {
  const [auditLog] = await knex<AuditLogEntry>('AuditLog')
    .insert({
      id: overrides.id ?? randomUUID(),
      envelopeId,
      action: overrides.action ?? 'initiated',
      metadata: overrides.metadata ?? { source: 'test' },
    })
    .returning('*');
  return auditLog;
};

// Test isolation between cases
export const cleanTestData = async (): Promise<void> => {
  await knex.raw('TRUNCATE TABLE "AuditLog", "Envelope" CASCADE');
};
```
