// Ports of the web E2E stack (backend + Vite demo per mode), from the
// environment. Every service in this repo listens on ESIGN_PORT_BASE
// (default 4100) plus its own offset, so one variable moves the whole stack
// and sibling worktrees never fight over a port (a foreign server on a
// shared port is reused by Playwright and every test fails on the first
// request): `ESIGN_PORT_BASE=4300 make e2e-web`. Each service's own
// variable overrides its port alone. The table is scripts/lib/ports.mjs;
// ports.test.ts keeps this copy on it.
//
//   ESIGN_API_PORT            the backend              base + 0
//   ESIGN_WEB_PORT            the demo, proxy mode     base + 1
//   ESIGN_WEB_WEBFORM_PORT    the demo, webform mode   base + 2
//   ESIGN_WEB_PUBLICURL_PORT  the demo, publicurl mode base + 3
//   ESIGN_TEST_DB_PORT        the E2E Postgres        base + 12
//
// Runs under Node (Playwright config) but is typechecked with the demo's
// browser tsconfig, so no node imports.

declare const process: { env: Record<string, string | undefined> };

export const MODES = ['proxy', 'webform', 'publicurl'] as const;
export type Mode = (typeof MODES)[number];

export const BASE_VAR = 'ESIGN_PORT_BASE';
export const BASE_DEFAULT = 4100;
export const API_VAR = 'ESIGN_API_PORT';
export const API_OFFSET = 0;
export const WEB_VARS: Record<Mode, string> = {
  proxy: 'ESIGN_WEB_PORT',
  webform: 'ESIGN_WEB_WEBFORM_PORT',
  publicurl: 'ESIGN_WEB_PUBLICURL_PORT',
};
export const WEB_OFFSETS: Record<Mode, number> = {
  proxy: 1,
  webform: 2,
  publicurl: 3,
};
export const TEST_DB_VAR = 'ESIGN_TEST_DB_PORT';
export const TEST_DB_OFFSET = 12;

export interface E2EPorts {
  api: number;
  vite: Record<Mode, number>;
  testDb: number;
}

// A port from one variable: unset or empty means the fallback; anything
// else must be a real port number, so a typo fails here and not as a
// server that never comes up
export const portFrom = (
  name: string,
  value: string | undefined,
  fallback: number,
): number => {
  if (value === undefined || value === '') {
    return fallback;
  }
  if (!/^\d+$/.test(value) || Number(value) < 1 || Number(value) > 65535) {
    throw new Error(
      `${name} must be a port number (1-65535), got ${JSON.stringify(value)}`,
    );
  }
  return Number(value);
};

export const portsFrom = (
  env: Record<string, string | undefined>,
): E2EPorts => {
  const base = portFrom(BASE_VAR, env[BASE_VAR], BASE_DEFAULT);
  const vite = {} as Record<Mode, number>;
  for (const mode of MODES) {
    vite[mode] = portFrom(
      WEB_VARS[mode],
      env[WEB_VARS[mode]],
      base + WEB_OFFSETS[mode],
    );
  }
  return {
    api: portFrom(API_VAR, env[API_VAR], base + API_OFFSET),
    vite,
    testDb: portFrom(TEST_DB_VAR, env[TEST_DB_VAR], base + TEST_DB_OFFSET),
  };
};

export const DEFAULT_PORTS = portsFrom({});
export const PORTS = portsFrom(process.env);
export const API_ORIGIN = `http://localhost:${PORTS.api}`;
const viteOrigin = (mode: Mode): string =>
  `http://localhost:${PORTS.vite[mode]}`;

// What CI changes about running the servers. In CI, a listener already on
// a port is a foreign leftover from a previous job, never this suite's own
// server - it must never be adopted, so CI always starts its own and fails
// if the port is taken; locally, reusing a dev server already running on
// these ports is the whole point. Retries: once in CI only, so a flaky
// runner doesn't fail the suite while a real failure still fails fast
// locally instead of being masked by a retry.
export const ciPolicy = (env: Record<string, string | undefined>) => ({
  reuseExistingServer: !env.CI,
  retries: env.CI ? 1 : 0,
});
const { reuseExistingServer, retries } = ciPolicy(process.env);
export { retries };

// Playwright webServer entries. The backend gets its port, its database (the
// E2E Postgres on this worktree's port, over .env.test's default) and the demo
// origins it must allow (CORS); the demo gets the backend origin.
export const backendServer = () => ({
  command: [
    `PORT=${PORTS.api}`,
    `DATABASE_URL=postgresql://test:test@localhost:${PORTS.testDb}/esign_test`,
    `CORS_ALLOWED_ORIGINS=${MODES.map(viteOrigin).join(',')}`,
    'ESIGN_PROVIDER=mock npx dotenv-cli -e packages/esign-service/.env.test -- npm run dev -w packages/esign-service',
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

// Vite dev server for the LIVE webform run: the demo in webform mode against
// an already-running service on the DocuSign provider (not this worktree's
// mock backend), minting with the given prefill (JSON) - see
// playwright.webform-live-demo.config.ts
export const liveViteDevServer = (
  apiOrigin: string,
  prefill: string | undefined,
  mode: Mode = 'webform',
) => ({
  command: `VITE_API_ORIGIN=${apiOrigin} VITE_ESIGN_MODE=${mode} VITE_ESIGN_PREFILL='${(prefill ?? '{}').replace(/'/g, '')}' npm run dev -- --port ${PORTS.vite[mode]} --strictPort`,
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
