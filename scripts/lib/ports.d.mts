// Types for ports.mjs, for the TypeScript consumers that check their own
// port copy against the table (examples/react-demo/e2e/ports.test.ts).

export type ServiceKey =
  | 'api'
  | 'webProxy'
  | 'webWebform'
  | 'webPublicurl'
  | 'mint'
  | 'handler'
  | 'live'
  | 'liveMint'
  | 'liveHandler'
  | 'smoke';

export interface Service {
  offset: number;
  env: string;
  what: string;
}

export type Env = Record<string, string | undefined>;

export const BASE_VAR: string;
export const BASE_DEFAULT: number;
export const SERVICES: Record<ServiceKey, Service>;
export function portFrom(
  name: string,
  value: string | undefined,
  fallback: number,
): number;
export function baseFrom(env: Env): number;
export function resolvePorts(env: Env): Record<ServiceKey | 'base', number>;
export function envLines(env: Env): string[];
