// The environment as this service reads it, and the one switch that turns
// the fail-closed posture off.
//
// It lives on its own so the boot guard (config.ts) can compose the modules
// that need the switch (session.ts) without a cycle: everything points at
// this module, this module points at nothing.

// Names to values, nothing else. Every check built on this is pure: env in,
// answer out - so a function target validates its configuration at first
// import exactly like a container validates it at boot.
export type Env = Record<string, string | undefined>;

// The explicit opt-in to running without session verification or webhook
// signatures. A deliberate, greppable flag: it can never be triggered by a
// missing or typo'd NODE_ENV.
export const ALLOW_INSECURE_DEV = 'ALLOW_INSECURE_DEV';

// True only when the operator has explicitly allowed running without the
// security secrets (local dev, E2E, CI against the mock provider).
export const isInsecureDevAllowed = (env: Env = process.env): boolean =>
  env[ALLOW_INSECURE_DEV] === 'true';
