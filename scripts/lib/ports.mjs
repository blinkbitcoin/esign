// The ports of every service this repo runs, from one base port. Every
// service listens on ESIGN_PORT_BASE (default 4100; 4000 is everybody's
// port) plus a fixed offset, so one variable moves a whole worktree
// (`ESIGN_PORT_BASE=4300 make e2e-web`) and repos never clash. Each service
// also has its own override variable for the odd case (a live run next to
// a dev server), which wins over the base. Consumers: the Playwright ports
// module (examples/react-demo/e2e/ports.ts, guarded against this table by
// its test), the shell scripts (through scripts/e2e/ports-env.sh) and the
// services' own PORT defaults (each declares its offset; ports.test.mjs
// checks the literals in those files against this table). The two Postgres
// containers are on the table too (docker-compose.test.yml and the dev
// compose read their host port from the variable), so a second worktree's
// databases never fight over 5432/5433 either.

export const BASE_VAR = 'ESIGN_PORT_BASE';
export const BASE_DEFAULT = 4100;
// A worktree's block: BLOCK_STEP ports wide (the table uses the first
// Object.keys(SERVICES).length), BLOCK_SLOTS blocks above the default one
// (4120 .. 4980; 5000 is everybody's and 5100 is kyc's).
export const BLOCK_STEP = 20;
export const BLOCK_SLOTS = 44;

/** key → { offset from the base, the override variable, what listens there } */
export const SERVICES = {
  api: { offset: 0, env: 'ESIGN_API_PORT', what: 'the esign-service backend' },
  webProxy: {
    offset: 1,
    env: 'ESIGN_WEB_PORT',
    what: 'react-demo, proxy mode',
  },
  webWebform: {
    offset: 2,
    env: 'ESIGN_WEB_WEBFORM_PORT',
    what: 'react-demo, webform mode',
  },
  webPublicurl: {
    offset: 3,
    env: 'ESIGN_WEB_PUBLICURL_PORT',
    what: 'react-demo, publicurl mode',
  },
  mint: { offset: 4, env: 'MINT_PORT', what: 'mint-only-demo' },
  handler: { offset: 5, env: 'HANDLER_PORT', what: 'serverless-handler-demo' },
  live: {
    offset: 6,
    env: 'LIVE_PORT',
    what: 'esign-service on DocuSign (make e2e-live)',
  },
  liveMint: {
    offset: 7,
    env: 'LIVE_MINT_PORT',
    what: 'mint-only-demo on DocuSign (make e2e-live)',
  },
  liveHandler: {
    offset: 8,
    env: 'LIVE_HANDLER_PORT',
    what: 'serverless-handler-demo on DocuSign (make e2e-live)',
  },
  smoke: {
    offset: 9,
    env: 'SMOKE_PORT',
    what: 'the service image (make docker-smoke)',
  },
  service: {
    offset: 10,
    env: 'SERVICE_PORT',
    what: 'the esign-service in the server-demos smoke',
  },
  terms: {
    offset: 11,
    env: 'TERMS_PORT',
    what: "the smoke's terms callback host",
  },
  testDb: {
    offset: 12,
    env: 'ESIGN_TEST_DB_PORT',
    what: 'the E2E Postgres (docker-compose.test.yml; CI macOS: Homebrew)',
  },
  devDb: {
    offset: 13,
    env: 'ESIGN_DEV_DB_PORT',
    what: 'the dev Postgres (packages/esign-service/docker-compose.yml)',
  },
};

/** The E2E database URL for its port (test/test, esign_test; .env.test carries the default) */
export const testDatabaseUrl = port =>
  `postgresql://test:test@localhost:${port}/esign_test`;
/** The dev database URL for its port (dev/dev, esign; what .env.example documents) */
export const devDatabaseUrl = port =>
  `postgresql://dev:dev@localhost:${port}/esign`;

/**
 * A port from one variable: unset or empty means the fallback; anything
 * else must be a real port number, so a typo fails here and not as a
 * server that never comes up.
 */
export const portFrom = (name, value, fallback) => {
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

/** The base port from the environment (validated), else the default. */
export const baseFrom = env => portFrom(BASE_VAR, env[BASE_VAR], BASE_DEFAULT);

/** Every service's port: its override variable if set, else base + offset. */
export const resolvePorts = env => {
  const base = baseFrom(env);
  const ports = { base };
  for (const [key, { offset, env: name }] of Object.entries(SERVICES)) {
    ports[key] = portFrom(name, env[name], base + offset);
  }
  return ports;
};

/**
 * Shell lines that export every service's override variable with its
 * resolved value (what scripts/e2e/ports-env.sh evals), so a script reads
 * `$ESIGN_API_PORT` and gets the base-derived default or the caller's own,
 * plus the two database URLs on their ports.
 */
export const envLines = env => {
  const ports = resolvePorts(env);
  return [
    `export ${BASE_VAR}=${ports.base}`,
    ...Object.entries(SERVICES).map(
      ([key, { env: name }]) => `export ${name}=${ports[key]}`,
    ),
    `export ESIGN_TEST_DATABASE_URL=${testDatabaseUrl(ports.testDb)}`,
    `export ESIGN_DEV_DATABASE_URL=${devDatabaseUrl(ports.devDb)}`,
  ];
};

// ---------- A worktree's own block ----------
// A linked worktree claims a block once: the lowest free slot above the
// default one, written as ESIGN_PORT_BASE=<base> into its .env.local (direnv
// loads it on every later cd; the Makefile asks `ports.mjs claim` when the
// variable is unset). The main clone and CI keep the default. The registry
// of claims is the worktrees themselves: every sibling's .env.local.

/** The worktrees of `git worktree list --porcelain`; the first one is the main clone */
export const parseWorktrees = porcelain =>
  porcelain
    .split('\n')
    .filter(line => line.startsWith('worktree '))
    .map((line, index) => ({
      path: line.slice('worktree '.length),
      isMain: index === 0,
    }));

/**
 * The base a .env.local claims (`ESIGN_PORT_BASE=4120`, `export` and quotes
 * tolerated, comments ignored, the last assignment wins), undefined without one.
 */
export const claimedBase = (text, name = BASE_VAR) => {
  let value;
  for (const line of text.split('\n')) {
    const match = line.match(
      new RegExp(
        `^\\s*(?:export\\s+)?${name}=\\s*["']?(\\d*)["']?\\s*(?:#.*)?$`,
      ),
    );
    if (match) {
      value = match[1];
    }
  }
  return value ? portFrom(name, value, undefined) : undefined;
};

/** The lowest block above the default that no sibling has claimed */
export const nextFreeBase = (
  claimed,
  { base = BASE_DEFAULT, step = BLOCK_STEP, slots = BLOCK_SLOTS } = {},
) => {
  const taken = new Set(claimed);
  for (let slot = 1; slot <= slots; slot += 1) {
    const candidate = base + slot * step;
    if (!taken.has(candidate)) {
      return candidate;
    }
  }
  throw new Error(
    `no free port block: all ${slots} blocks above ${base} are claimed (free one by removing a worktree, or set ${BASE_VAR} yourself)`,
  );
};

/** The .env.local text with the claim appended (unchanged when it already claims that base) */
export const withClaimedBase = (text, base, name = BASE_VAR) => {
  if (claimedBase(text, name) === base) {
    return text;
  }
  const body = text.length > 0 && !text.endsWith('\n') ? `${text}\n` : text;
  return `${body}# This worktree's port block (scripts/lib/ports.mjs; make ports shows it)\n${name}=${base}\n`;
};
