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
  | 'smoke'
  | 'service'
  | 'terms'
  | 'testDb'
  | 'devDb';

export interface Service {
  offset: number;
  env: string;
  what: string;
}

export type Env = Record<string, string | undefined>;

export const BASE_VAR: string;
export const BASE_DEFAULT: number;
export const BLOCK_STEP: number;
export const BLOCK_SLOTS: number;
export const SERVICES: Record<ServiceKey, Service>;
export function portFrom(
  name: string,
  value: string | undefined,
  fallback: number,
): number;
export function baseFrom(env: Env): number;
export function resolvePorts(env: Env): Record<ServiceKey | 'base', number>;
export function envLines(env: Env): string[];
export function testDatabaseUrl(port: number): string;
export function devDatabaseUrl(port: number): string;
export function parseWorktrees(
  porcelain: string,
): { path: string; isMain: boolean }[];
export function claimedBase(text: string, name?: string): number | undefined;
export function nextFreeBase(
  claimed: number[],
  geometry?: { base?: number; step?: number; slots?: number },
): number;
export function withClaimedBase(
  text: string,
  base: number,
  name?: string,
): string;
