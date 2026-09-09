// The per-worktree port scheme the Playwright configs rely on.

declare const process: { env: Record<string, string | undefined> };

import {
  BLOCKS,
  MODES,
  PORTS,
  WORKTREE_ROOT,
  backendServer,
  baseURL,
  blockFor,
  ciPolicy,
  fnv1a,
  liveViteDevServer,
  portsForBlock,
  viteDevServer,
  vitePreviewServer,
} from './ports';

describe('fnv1a', () => {
  it('is deterministic and spreads sibling worktree paths apart', () => {
    expect(fnv1a('/Users/x/Dev/esign')).toBe(fnv1a('/Users/x/Dev/esign'));
    expect(fnv1a('/Users/x/Dev/esign')).not.toBe(fnv1a('/Users/x/Dev/esign-2'));
    expect(fnv1a('')).toBe(0x811c9dc5);
  });
});

describe('blockFor', () => {
  it('derives a block inside the range from the worktree path', () => {
    for (const root of [
      '/a',
      '/Users/x/Dev/esign',
      '/home/runner/work/esign/esign',
    ]) {
      const block = blockFor(root);
      expect(block).toBeGreaterThanOrEqual(0);
      expect(block).toBeLessThan(BLOCKS);
      expect(block).toBe(blockFor(root));
    }
  });

  it('is pinned by E2E_PORT_OFFSET when set, and derived when it is empty', () => {
    expect(blockFor('/anything', '0')).toBe(0);
    expect(blockFor('/anything', String(BLOCKS - 1))).toBe(BLOCKS - 1);
    expect(blockFor('/anything', '')).toBe(blockFor('/anything'));
  });

  it.each(['-1', String(BLOCKS), '1.5', 'abc', ' '])(
    'rejects the out-of-range or malformed pin %j',
    pin => {
      expect(() => blockFor('/anything', pin)).toThrow(
        /E2E_PORT_OFFSET must be an integer/,
      );
    },
  );
});

describe('portsForBlock', () => {
  it('block 0 is the canonical port set the docs quote', () => {
    expect(portsForBlock(0)).toEqual({
      api: 4000,
      vite: { proxy: 5173, webform: 5174, publicurl: 5175 },
    });
  });

  it('blocks never overlap each other or the backend range', () => {
    const seen = new Set<number>();
    for (let block = 0; block < BLOCKS; block++) {
      const ports = portsForBlock(block);
      for (const port of [ports.api, ...MODES.map(mode => ports.vite[mode])]) {
        expect(seen.has(port)).toBe(false);
        seen.add(port);
      }
    }
    expect(seen.size).toBe(BLOCKS * (1 + MODES.length));
  });
});

describe('ciPolicy', () => {
  it('reuses a running server and never retries locally', () => {
    expect(ciPolicy({})).toEqual({ reuseExistingServer: true, retries: 0 });
  });

  it('never adopts a foreign listener and retries once in CI', () => {
    expect(ciPolicy({ CI: 'true' })).toEqual({
      reuseExistingServer: false,
      retries: 1,
    });
  });
});

describe('liveViteDevServer', () => {
  it('points the webform demo at the live service and hands it the prefill', () => {
    const server = liveViteDevServer('http://localhost:4010', '{"a":1}');
    expect(server.command).toContain('VITE_API_ORIGIN=http://localhost:4010 ');
    expect(server.command).toContain('VITE_ESIGN_MODE=webform ');
    expect(server.command).toContain(`VITE_ESIGN_PREFILL='{"a":1}' `);
    expect(server.command).toContain(
      `--port ${PORTS.vite.webform} --strictPort`,
    );
    expect(server.url).toBe(baseURL('webform'));
    expect(server.reuseExistingServer).toBe(false);
    // No prefill → an empty object; single quotes never break the shell
    expect(liveViteDevServer('http://x', undefined).command).toContain(
      "VITE_ESIGN_PREFILL='{}'",
    );
    expect(liveViteDevServer('http://x', `{"n":"o'x"}`).command).toContain(
      `VITE_ESIGN_PREFILL='{"n":"ox"}'`,
    );
  });
});

describe('this worktree', () => {
  it('resolves the repo root and a consistent port set', () => {
    expect(WORKTREE_ROOT).toMatch(/^\/.+[^/]$/);
    expect(WORKTREE_ROOT.endsWith('/examples/react-demo')).toBe(false);
    expect(PORTS).toEqual(
      portsForBlock(blockFor(WORKTREE_ROOT, process.env.E2E_PORT_OFFSET)),
    );
  });

  it('wires the backend port, CORS origins and the demo origin into the servers', () => {
    const backend = backendServer();
    expect(backend.command).toContain(`PORT=${PORTS.api} `);
    expect(backend.command).toContain(
      `CORS_ALLOWED_ORIGINS=http://localhost:${PORTS.vite.proxy},http://localhost:${PORTS.vite.webform},http://localhost:${PORTS.vite.publicurl} `,
    );
    expect(backend.url).toBe(`http://localhost:${PORTS.api}/health`);

    const dev = viteDevServer('webform');
    expect(dev.command).toContain(
      `VITE_API_ORIGIN=http://localhost:${PORTS.api} `,
    );
    expect(dev.command).toContain('VITE_ESIGN_MODE=webform ');
    expect(dev.command).toContain(`--port ${PORTS.vite.webform} --strictPort`);
    expect(dev.url).toBe(baseURL('webform'));

    const preview = vitePreviewServer('proxy');
    expect(preview.command).toContain(
      `VITE_API_ORIGIN=http://localhost:${PORTS.api} `,
    );
    expect(preview.command).toContain(
      `--port ${PORTS.vite.proxy} --strictPort`,
    );
    expect(preview.url).toBe(`http://localhost:${PORTS.vite.proxy}`);
  });
});
