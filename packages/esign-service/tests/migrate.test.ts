// The migrate CLI: runs the package migrations, closes the pool, and exits
// non-zero on failure.

import { vi } from 'vitest';

const destroy = vi.fn(async () => undefined);
vi.mock('../src/db', () => ({
  DATABASE_URL: 'DATABASE_URL',
  createKnexClient: () => ({ destroy }),
}));
const runESignMigrations = vi.fn();
vi.mock('@blinkbitcoin/esign-node/knex', () => ({
  runESignMigrations: (...args: unknown[]) => runESignMigrations(...args),
}));

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('migrate', () => {
  beforeEach(() => {
    vi.resetModules();
    destroy.mockClear();
    runESignMigrations.mockReset();
  });

  it('applies the migrations through a client built from the process env and closes it', async () => {
    runESignMigrations.mockResolvedValue([1, ['m']]);
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    await import('../src/migrate');
    await flush();
    expect(runESignMigrations).toHaveBeenCalledWith({ destroy });
    expect(log).toHaveBeenCalledWith('Migrations applied.');
    expect(destroy).toHaveBeenCalled();
    log.mockRestore();
  });

  it('reports a failure, closes the pool and exits 1', async () => {
    runESignMigrations.mockRejectedValue(new Error('boom'));
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    await import('../src/migrate');
    await flush();
    expect(error).toHaveBeenCalledWith('Migration failed:', expect.any(Error));
    expect(destroy).toHaveBeenCalled();
    expect(exit).toHaveBeenCalledWith(1);
    error.mockRestore();
    exit.mockRestore();
  });
});
