// The service's port: PORT, else ESIGN_PORT_BASE plus this service's offset
// (every service in the repo is base + offset, table in scripts/lib/ports.mjs;
// 4000 is everybody's port, hence 4100). The origin derived from it is what
// the mock provider's signing pages and the DocuSign return URL default to.

export const PORT_BASE_DEFAULT = 4100;
export const PORT_OFFSET = 0;

const digits = (value: string | undefined): number | undefined =>
  value !== undefined && /^\d+$/.test(value) ? Number(value) : undefined;

export const resolvePort = (env: NodeJS.ProcessEnv = process.env): number =>
  digits(env.PORT) ?? (digits(env.ESIGN_PORT_BASE) ?? PORT_BASE_DEFAULT) + PORT_OFFSET;

export const localOrigin = (env: NodeJS.ProcessEnv = process.env): string =>
  `http://localhost:${resolvePort(env)}`;
