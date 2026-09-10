// The process entry point: what the image's CMD and `npx esign-service` do.
// It is a program, so the test imports it for its side effects with the two
// things it can reach (the server, the migration) replaced.

import { vi } from 'vitest';

const startServer = vi.fn(async () => ({ url: 'http://localhost:4000', stop: vi.fn() }));
const initTelemetry = vi.fn();
const migrated = vi.fn();

// Loading a real .env would make the run depend on the developer's machine
vi.mock('dotenv/config', () => ({}));
vi.mock('../src/instrumentation', () => ({ initTelemetry: () => initTelemetry() }));
vi.mock('../src/server', () => ({ startServer: () => startServer() }));
vi.mock('../src/migrate', () => {
  migrated();
  return {};
});

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

  it('reports a failure to start and exits non-zero', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    startServer.mockRejectedValueOnce(new Error('port in use'));

    await runEntryPoint();

    expect(error).toHaveBeenCalledWith('Failed to start esign-service:', expect.any(Error));
    expect(exit).toHaveBeenCalledWith(1);
  });
});
