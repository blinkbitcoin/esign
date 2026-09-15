// Where the esign service listens, when nobody says otherwise. Every service
// in the repo is ESIGN_PORT_BASE plus a fixed offset (table:
// scripts/lib/ports.mjs; 4000 is everybody's port, hence 4100), so one
// variable moves a whole worktree. This package cannot import that table - it
// is published - so it declares the base and its offset as literals, and
// scripts/lib/ports.test.mjs keeps them on the table.

export const PORT_BASE_DEFAULT = 4100;
// The esign service's offset (SERVICES.api). Not this host's: a host that
// embeds this package binds its OWN port (the mint-only demo is base + 4),
// while the mock's signing pages are served by the service at base + 0. So
// PORT is deliberately not read here - it would point the pages at whatever
// host happened to mint them, which is exactly the bug this replaced.
export const API_OFFSET = 0;

const digits = (value: string | undefined): number | undefined =>
  value !== undefined && /^\d+$/.test(value) ? Number(value) : undefined;

/** The origin the esign service serves on, derived from `env`. */
export const serviceOrigin = (
  env: Record<string, string | undefined>,
): string =>
  `http://localhost:${(digits(env.ESIGN_PORT_BASE) ?? PORT_BASE_DEFAULT) + API_OFFSET}`;
