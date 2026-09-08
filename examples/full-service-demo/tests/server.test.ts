// Tests for the real HTTP server startup (src/server.ts).
// Uses port 0 so the OS assigns an ephemeral port - no collisions, no mocks.

import type http from 'http';
import type { AddressInfo } from 'net';
import { vi } from 'vitest';
import { startServer } from '../src/server';

describe('startServer', () => {
  let server: http.Server;
  let logSpy: ReturnType<typeof vi.spyOn>;
  const originalProvider = process.env.ESIGN_PROVIDER;

  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(async () => {
    logSpy.mockRestore();
    if (originalProvider !== undefined) {
      process.env.ESIGN_PROVIDER = originalProvider;
    } else {
      delete process.env.ESIGN_PROVIDER;
    }
    if (server?.listening) {
      await new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve()))
      );
    }
  });

  it('starts listening and serves the health endpoint', async () => {
    server = await startServer(0);

    expect(server.listening).toBe(true);
    const { port } = server.address() as AddressInfo;
    expect(port).toBeGreaterThan(0);

    const response = await fetch(`http://localhost:${port}/health`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { status: string };
    expect(body.status).toBe('ok');
  });

  it('logs the bound endpoints and the configured provider', async () => {
    process.env.ESIGN_PROVIDER = 'mock';

    server = await startServer(0);
    const { port } = server.address() as AddressInfo;

    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining(`http://localhost:${port}/graphql`)
    );
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('E-signature provider: mock'));
  });

  it('defaults the logged provider to mock when ESIGN_PROVIDER is unset', async () => {
    delete process.env.ESIGN_PROVIDER;

    server = await startServer(0);

    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('E-signature provider: mock'));
  });
});
