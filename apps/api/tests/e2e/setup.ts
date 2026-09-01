// E2E test setup with a real knex/Postgres connection
// Uses real database connection - NO mocks
// TRUNCATE CASCADE for test isolation
// NOTE: Tests run sequentially (fileParallelism: false) to prevent parallel execution issues

import createKnex from 'knex';

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error('DATABASE_URL environment variable is required for E2E tests');
}

// Create real knex client for E2E tests
export const knex = createKnex({
  client: 'pg',
  connection: connectionString,
});

// Verify database connection, apply migrations, and clean state before running tests
beforeAll(async () => {
  // Test connection with retry logic
  let connected = false;
  let lastError: Error | null = null;

  for (let i = 0; i < 5; i++) {
    try {
      await knex.raw('SELECT 1');
      connected = true;
      break;
    } catch (error) {
      lastError = error as Error;
      // Wait before retry
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }

  if (!connected) {
    throw new Error(`Failed to connect to test database after 5 attempts: ${lastError?.message}`);
  }

  // Ensure schema is up to date (directory is resolved relative to process.cwd())
  await knex.migrate.latest({ directory: 'migrations', extension: 'ts' });

  // TRUNCATE CASCADE ensures all related records are removed
  // Order matters due to foreign key constraints: AuditLog references Envelope
  await knex.raw('TRUNCATE TABLE "AuditLog", "Envelope" CASCADE');
});

// Clean database after test suite and disconnect
afterAll(async () => {
  await knex.raw('TRUNCATE TABLE "AuditLog", "Envelope" CASCADE');
  await knex.destroy();
});
