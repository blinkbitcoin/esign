// The ports of every service this repo runs, from one base port. Every
// service listens on ESIGN_PORT_BASE (default 4100; 4000 is everybody's
// port) plus a fixed offset, so one variable moves a whole worktree
// (`ESIGN_PORT_BASE=4300 make e2e-web`) and repos never clash. Each service
// also has its own override variable for the odd case (a live run next to
// a dev server), which wins over the base. Consumers: the Playwright ports
// module (examples/react-demo/e2e/ports.ts, guarded against this table by
// its test), the shell scripts (through scripts/e2e/ports-env.sh) and the
// services' own PORT defaults (each declares its offset; ports.test.mjs
// checks the literals in those files against this table).

export const BASE_VAR = 'ESIGN_PORT_BASE';
export const BASE_DEFAULT = 4100;

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
};

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
 * `$ESIGN_API_PORT` and gets the base-derived default or the caller's own.
 */
export const envLines = env => {
  const ports = resolvePorts(env);
  return [
    `export ${BASE_VAR}=${ports.base}`,
    ...Object.entries(SERVICES).map(
      ([key, { env: name }]) => `export ${name}=${ports[key]}`,
    ),
  ];
};
