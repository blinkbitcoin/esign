// The programmatic migration source: what it creates, what it drops, that
// it is idempotent, and that Knex's migrator can drive it. The Knex schema
// builder is faked so no Postgres is needed; the table definitions are
// asserted through the builder calls.

import type { Knex } from 'knex';
import {
  createESignMigrationSource,
  ESIGN_MIGRATIONS,
  runESignMigrations,
} from '../migrations';

// A chainable column builder that records every call
const columnCalls: string[] = [];
const column = (): Record<string, jest.Mock> => {
  const self: Record<string, jest.Mock> = {};
  for (const m of [
    'primary',
    'notNullable',
    'unique',
    'defaultTo',
    'references',
    'inTable',
    'onDelete',
  ]) {
    self[m] = jest.fn((...args: unknown[]) => {
      columnCalls.push(`${m}(${args.map(String).join(',')})`);
      return self;
    });
  }
  return self;
};

const fakeDb = (existing: string[] = []) => {
  const tables: Record<string, string[]> = {};
  const tableBuilder = (name: string) => {
    const cols: string[] = [];
    tables[name] = cols;
    const define = (type: string) => (col: string) => {
      cols.push(`${type}:${col}`);
      return column();
    };
    return {
      text: define('text'),
      timestamp: define('timestamp'),
      jsonb: define('jsonb'),
    };
  };
  const schema = {
    hasTable: jest.fn(async (name: string) => existing.includes(name)),
    createTable: jest.fn(async (name: string, cb: (t: unknown) => void) => {
      cb(tableBuilder(name));
    }),
    dropTableIfExists: jest.fn(async (_name: string) => undefined),
  };
  const db = {
    schema,
    fn: { now: () => 'now()' },
    migrate: { latest: jest.fn(async () => [1, ['m']]) },
  } as unknown as Knex;
  return { db, schema, tables };
};

describe('ESIGN_MIGRATIONS', () => {
  beforeEach(() => {
    columnCalls.length = 0;
  });

  it('creates the Envelope and AuditLog tables with their columns and constraints', async () => {
    const { db, schema, tables } = fakeDb();
    await ESIGN_MIGRATIONS[0].up(db);
    expect(schema.createTable.mock.calls.map(c => c[0])).toEqual([
      'Envelope',
      'AuditLog',
    ]);
    expect(tables.Envelope).toEqual([
      'text:id',
      'text:providerEnvelopeId',
      'text:userId',
      'text:contractType',
      'text:status',
      'timestamp:createdAt',
      'timestamp:updatedAt',
    ]);
    expect(tables.AuditLog).toEqual([
      'text:id',
      'text:envelopeId',
      'text:action',
      'timestamp:timestamp',
      'jsonb:metadata',
    ]);
    expect(columnCalls).toEqual(
      expect.arrayContaining([
        'primary()',
        'unique()',
        'defaultTo(now())',
        'references(id)',
        'inTable(Envelope)',
        'onDelete(CASCADE)',
      ]),
    );
  });

  it('is idempotent: skips tables that already exist', async () => {
    const { db, schema } = fakeDb(['Envelope', 'AuditLog']);
    await ESIGN_MIGRATIONS[0].up(db);
    expect(schema.createTable).not.toHaveBeenCalled();
    const partial = fakeDb(['Envelope']);
    await ESIGN_MIGRATIONS[0].up(partial.db);
    expect(partial.schema.createTable.mock.calls.map(c => c[0])).toEqual([
      'AuditLog',
    ]);
  });

  it('drops AuditLog before Envelope on the way down', async () => {
    const { db, schema } = fakeDb(['Envelope', 'AuditLog']);
    await ESIGN_MIGRATIONS[0].down(db);
    expect(schema.dropTableIfExists.mock.calls.map(c => c[0])).toEqual([
      'AuditLog',
      'Envelope',
    ]);
  });

  it('keeps the original file-based migration name so existing histories match', () => {
    expect(ESIGN_MIGRATIONS[0].name).toBe(
      '20260702083000_create_envelope_and_audit_log_tables.ts',
    );
  });
});

describe('createESignMigrationSource', () => {
  it('exposes the migrations to the Knex migrator in order, by name', async () => {
    const source = createESignMigrationSource();
    const migrations = await source.getMigrations([]);
    expect(migrations).toEqual([...ESIGN_MIGRATIONS]);
    expect(migrations).not.toBe(ESIGN_MIGRATIONS);
    expect(source.getMigrationName(migrations[0])).toBe(
      ESIGN_MIGRATIONS[0].name,
    );
    expect(await source.getMigration(migrations[0])).toBe(migrations[0]);
  });
});

describe('runESignMigrations', () => {
  it('runs migrate.latest with the source', async () => {
    const { db } = fakeDb();
    await runESignMigrations(db);
    expect(db.migrate.latest).toHaveBeenCalledWith({
      migrationSource: expect.objectContaining({
        getMigrations: expect.any(Function),
      }),
    });
  });
});
