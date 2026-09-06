// Ports for the web E2E stack (backend + Vite demo per mode).
//
// Every git worktree gets its own stable block, derived from a hash of the
// worktree path: parallel sessions in sibling worktrees never fight over the
// canonical :4000 / :5173 (a foreign server on a shared port is reused by
// Playwright and every test fails on the first request). E2E_PORT_OFFSET pins
// the block explicitly - 0 gives the canonical ports the docs quote.
//
// Runs under Node (Playwright config) but is typechecked with the demo's
// browser tsconfig, so no node imports: the hash is inline and the worktree
// path comes from import.meta.url.

declare const process: { env: Record<string, string | undefined> };

// Blocks of ports; the backend takes one port per block, Vite three (one per
// mode), and the two ranges never overlap: 4000-4249 vs 5173-5922.
export const BLOCKS = 250;
const API_BASE = 4000;
const VITE_BASE = 5173;
export const MODES = ['proxy', 'webform', 'publicurl'] as const;
export type Mode = (typeof MODES)[number];

// FNV-1a (32-bit): small, dependency-free, stable across runs and machines
/* eslint-disable no-bitwise -- the hash is bit arithmetic by definition */
export const fnv1a = (text: string): number => {
  let hash = 0x811c9dc5;
  for (const char of text) {
    hash ^= char.codePointAt(0) as number;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
};
/* eslint-enable no-bitwise */

// The block for a worktree root, or the pinned one from E2E_PORT_OFFSET
// (an empty pin counts as unset)
export const blockFor = (root: string, override?: string): number => {
  if (override !== undefined && override !== '') {
    if (!/^\d+$/.test(override) || Number(override) >= BLOCKS) {
      throw new Error(
        `E2E_PORT_OFFSET must be an integer in [0, ${BLOCKS}), got ${JSON.stringify(override)}`,
      );
    }
    return Number(override);
  }
  return fnv1a(root) % BLOCKS;
};

export interface E2EPorts {
  api: number;
  vite: Record<Mode, number>;
}

export const portsForBlock = (block: number): E2EPorts => ({
  api: API_BASE + block,
  vite: {
    proxy: VITE_BASE + block * MODES.length,
    webform: VITE_BASE + block * MODES.length + 1,
    publicurl: VITE_BASE + block * MODES.length + 2,
  },
});

// This worktree's root (examples/react-demo/e2e/ → ../../..)
export const WORKTREE_ROOT = decodeURIComponent(
  new URL('../../..', import.meta.url).pathname,
).replace(/\/$/, '');

export const PORTS = portsForBlock(
  blockFor(WORKTREE_ROOT, process.env.E2E_PORT_OFFSET),
);
export const API_ORIGIN = `http://localhost:${PORTS.api}`;
const viteOrigin = (mode: Mode): string =>
  `http://localhost:${PORTS.vite[mode]}`;

// What CI changes about running the servers. In CI, a listener already on
// a port is a foreign leftover from a previous job, never this suite's own
// server - it must never be adopted, so CI always starts its own and fails
// if the port is taken; locally, reusing a dev server already running on the
// worktree's ports is the whole point. Retries: once in CI only, so a flaky
// runner doesn't fail the suite while a real failure still fails fast
// locally instead of being masked by a retry.
export const ciPolicy = (env: Record<string, string | undefined>) => ({
  reuseExistingServer: !env.CI,
  retries: env.CI ? 1 : 0,
});
const { reuseExistingServer, retries } = ciPolicy(process.env);
export { retries };

// Playwright webServer entries. The backend gets its port and the demo
// origins it must allow (CORS); the demo gets the backend origin.
export const backendServer = () => ({
  command: [
    `PORT=${PORTS.api}`,
    `CORS_ALLOWED_ORIGINS=${MODES.map(viteOrigin).join(',')}`,
    'ESIGN_PROVIDER=mock npx dotenv-cli -e apps/api/.env.test -- npm run dev -w apps/api',
  ].join(' '),
  cwd: '../..',
  url: `${API_ORIGIN}/health`,
  reuseExistingServer,
  timeout: 30_000,
});

// Vite dev server for a mode (webform / publicurl specs)
export const viteDevServer = (mode: Mode) => ({
  command: `VITE_API_ORIGIN=${API_ORIGIN} VITE_ESIGN_MODE=${mode} npm run dev -- --port ${PORTS.vite[mode]} --strictPort`,
  url: viteOrigin(mode),
  reuseExistingServer: false,
  timeout: 30_000,
});

// Production build + preview (proxy spec: bundles the demo against the
// packages' dist, what CI's Web job verifies)
export const vitePreviewServer = (mode: Mode) => ({
  command: `VITE_API_ORIGIN=${API_ORIGIN} npm run build -- --outDir dist/${mode} && npm run preview -- --outDir dist/${mode} --port ${PORTS.vite[mode]} --strictPort`,
  url: viteOrigin(mode),
  reuseExistingServer,
  timeout: 30_000,
});

export const baseURL = (mode: Mode): string => viteOrigin(mode);
