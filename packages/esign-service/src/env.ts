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

// The opt-in to refusing to start over anything this deployment does not
// verify.
//
// Off by default, and that default is the point: what an unverified session
// or a client-supplied prefill means depends on what sits in front of the
// service and what the template's fields carry, neither of which is visible
// from in here. So the service reports its posture (posture.ts) and runs,
// and an operator who wants a deployment to fail closed says so once.
export const ESIGN_STRICT = 'ESIGN_STRICT';

// True only for the exact string: a typo must not silently arm a gate that
// refuses to boot, and must not silently disarm one either.
export const isStrict = (env: Env = process.env): boolean => env[ESIGN_STRICT] === 'true';
