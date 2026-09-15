// The process entry point: what the image's CMD and `npx esign-service` do.
// It is a program, so the test imports it for its side effects with the two
// things it can reach (the server, the migration) replaced.

import { vi } from 'vitest';

const startServer = vi.fn(async () => ({ url: 'http://localhost:4000', stop: vi.fn() }));
const initTelemetry = vi.fn();
const migrated = vi.fn();
const checked = vi.fn(async () => ({ output: 'the report', code: 0 }));

// Loading a real .env would make the run depend on the developer's machine
vi.mock('dotenv/config', () => ({}));
vi.mock('../src/instrumentation', () => ({ initTelemetry: () => initTelemetry() }));
vi.mock('../src/server', () => ({ startServer: () => startServer() }));
vi.mock('../src/migrate', () => {
  migrated();
  return {};
});
vi.mock('../src/check', () => ({
  runCheckCommand: (command: string, argv: readonly string[]) => checked(command, argv),
}));

// The entry point runs at import, and its work is a floating promise
const runEntryPoint = async (...args: string[]): Promise<void> => {
  vi.resetModules();
  vi.stubGlobal('process', Object.assign(process, { argv: ['node', 'dist/node.js', ...args] }));
  await import('../src/node');
  await new Promise((resolve) => setTimeout(resolve, 0));
};

describe('the process entry point', () => {
  const argv = process.argv;

  beforeEach(() => {
    startServer.mockClear();
    initTelemetry.mockClear();
    migrated.mockClear();
    checked.mockClear();
  });

  afterEach(() => {
    process.argv = argv;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('starts telemetry and then the server', async () => {
    await runEntryPoint();

    expect(initTelemetry).toHaveBeenCalled();
    expect(startServer).toHaveBeenCalled();
    expect(migrated).not.toHaveBeenCalled();
  });

  it('runs the migrations instead when told to', async () => {
    await runEntryPoint('migrate');

    expect(migrated).toHaveBeenCalled();
    expect(startServer).not.toHaveBeenCalled();
  });

  // The two diagnostics an operator runs instead of guessing. The entry
  // point only prints what the command returns and adopts its exit code.
  it('runs the session check and prints its report', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});

    await runEntryPoint('check-session', 'a.b.c');

    expect(checked).toHaveBeenCalledWith('check-session', ['a.b.c']);
    expect(log).toHaveBeenCalledWith('the report');
    expect(startServer).not.toHaveBeenCalled();
  });

  it('runs the prefill check', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});

    await runEntryPoint('check-prefill');

    expect(checked).toHaveBeenCalledWith('check-prefill', []);
  });

  it('adopts the exit code the check reports', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    checked.mockResolvedValueOnce({ output: 'nope', code: 1 });

    await runEntryPoint('check-session', 'a.b.c');

    expect(process.exitCode).toBe(1);
    process.exitCode = 0;
  });

  it('reports a failure to start and exits non-zero', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    startServer.mockRejectedValueOnce(new Error('port in use'));

    await runEntryPoint();

    expect(error).toHaveBeenCalledWith('Failed to start esign-service:', expect.any(Error));
    expect(exit).toHaveBeenCalledWith(1);
  });
});
