// Confirming a configuration without deploying it.
//
// `jwtVerify` stops at the first failure, which is exactly wrong for someone
// trying to find out why their setup does not work: they fix the issuer, get
// a fresh 401, and learn only then that the audience was also wrong. These
// checks run independently and report every line, so one run names every
// problem.
//
// Reached as `node dist/node.js check-session <token>` and `check-prefill`
// (node.ts), beside the migrate command.

import { decodeJwt, decodeProtectedHeader } from 'jose';

import type { Env } from './env';
import { ESIGN_PREFILL_SECRET, ESIGN_PREFILL_URL, prefillConfigFromEnv } from './prefill';
import { preflight } from './preflight';
import {
  DEFAULT_USER_CLAIM,
  ESIGN_SESSION_AUDIENCE,
  ESIGN_SESSION_ISSUER,
  ESIGN_SESSION_USER_CLAIM,
  sessionSourceFromEnv,
  verifySignature,
} from './session';

export interface CheckLine {
  // The step, as the left column of the report
  label: string;
  ok: boolean;
  detail: string;
}

export interface CheckDeps {
  fetch?: typeof globalThis.fetch;
}

const line = (label: string, ok: boolean, detail: string): CheckLine => ({ label, ok, detail });

// Compare a configured value with the token's, when both exist. The trailing
// slash on an issuer is the single most common real misconfiguration, so the
// detail quotes both sides rather than saying "mismatch".
const compare = (label: string, configured: string | undefined, actual: unknown): CheckLine => {
  if (!configured) {
    return line(
      label,
      true,
      `not enforced (${label === 'issuer' ? ESIGN_SESSION_ISSUER : ESIGN_SESSION_AUDIENCE} unset)`
    );
  }
  const value = Array.isArray(actual) ? actual : [actual];
  return value.includes(configured)
    ? line(label, true, configured)
    : line(
        label,
        false,
        `token says ${JSON.stringify(actual)}, configured ${JSON.stringify(configured)}`
      );
};

// Walk a real token through this environment's configuration, one step per
// line, without short-circuiting.
export const checkSession = async (
  env: Env,
  token: string,
  deps: CheckDeps = {}
): Promise<CheckLine[]> => {
  const source = sessionSourceFromEnv(env);
  const lines: CheckLine[] = [
    source === 'unverified'
      ? line('source', false, 'nothing configured - the bearer token is taken as the user id')
      : line('source', true, source),
  ];

  // Is the key set readable at all? Same probe the banner prints.
  if (source === 'jwks') {
    const [probe] = await preflight(env, deps);
    lines.push(line('key set', probe.ok, probe.detail));
  }

  let header: Record<string, unknown>;
  let claims: Record<string, unknown>;
  try {
    header = decodeProtectedHeader(token) as Record<string, unknown>;
    claims = decodeJwt(token) as Record<string, unknown>;
  } catch {
    lines.push(line('token', false, 'not a JWT this can read'));
    return lines;
  }
  lines.push(
    line('token', true, `${String(header.alg)}${header.kid ? `, kid ${String(header.kid)}` : ''}`)
  );

  // The signature ALONE. jwtVerify enforces issuer and audience in the same
  // call, so using the real verifier here would report a wrong issuer as a
  // signature failure - sending an operator to the wrong variable, which is
  // the exact failure this whole command exists to prevent.
  const signature = await verifySignature(env, token);
  lines.push(
    signature === null
      ? line('signature', false, 'not checked - no key material configured')
      : line('signature', signature, signature ? 'verified' : 'did not verify')
  );

  const exp = typeof claims.exp === 'number' ? claims.exp : undefined;
  const seconds = exp === undefined ? undefined : exp - Math.floor(Date.now() / 1000);
  lines.push(
    seconds === undefined
      ? line('expiry', false, 'no exp claim - a token without one would be valid forever')
      : line(
          'expiry',
          seconds > 0,
          seconds > 0
            ? `expires in ${Math.round(seconds / 60)}m`
            : `expired ${Math.round(-seconds / 60)}m ago`
        )
  );

  lines.push(compare('issuer', env[ESIGN_SESSION_ISSUER], claims.iss));
  lines.push(compare('audience', env[ESIGN_SESSION_AUDIENCE], claims.aud));

  const claim = env[ESIGN_SESSION_USER_CLAIM] || DEFAULT_USER_CLAIM;
  const user = claims[claim];
  lines.push(
    typeof user === 'string' && user !== ''
      ? line('user id', true, `${claim} = ${user}`)
      : line('user id', false, `no usable "${claim}" claim - set ${ESIGN_SESSION_USER_CLAIM}`)
  );

  return lines;
};

// Ask the prefill callback for real and report what came back, so a wrong
// path or a wrong secret is a line here instead of a 502 on every mint.
export const checkPrefill = async (env: Env, deps: CheckDeps = {}): Promise<CheckLine[]> => {
  const config = prefillConfigFromEnv(env);
  if (!config) {
    return [
      line('source', false, `${ESIGN_PREFILL_URL} unset - the client's own prefill is minted`),
    ];
  }
  const lines: CheckLine[] = [
    line('source', true, config.url),
    line(
      'secret',
      Boolean(config.secret),
      config.secret ? 'sent' : `${ESIGN_PREFILL_SECRET} unset`
    ),
  ];

  const doFetch = deps.fetch ?? globalThis.fetch;
  let response: Response;
  try {
    response = await doFetch(config.url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(config.secret ? { 'x-esign-prefill-secret': config.secret } : {}),
      },
      body: JSON.stringify({ userId: 'check', input: {} }),
      signal: AbortSignal.timeout(config.timeoutMs),
    });
  } catch (error) {
    lines.push(line('reply', false, error instanceof Error ? error.message : String(error)));
    return lines;
  }
  if (!response.ok) {
    lines.push(line('reply', false, `answered ${response.status}`));
    return lines;
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    lines.push(line('reply', false, 'did not answer with JSON'));
    return lines;
  }
  const prefill = (body as { prefill?: unknown } | null)?.prefill;
  lines.push(
    prefill && typeof prefill === 'object' && !Array.isArray(prefill)
      ? line('reply', true, `prefill with ${Object.keys(prefill).length} field(s)`)
      : line('reply', false, 'answered without a prefill object')
  );
  return lines;
};

// The report as an operator reads it: a mark, the step, the detail.
export const formatCheck = (lines: readonly CheckLine[]): string =>
  lines
    .map((entry) => `  ${entry.ok ? '✓' : '✗'} ${entry.label.padEnd(10)} ${entry.detail}`)
    .join('\n');

export interface CheckCommand {
  // What to print
  output: string;
  // The process exit code: non-zero when any line failed, so CI and a shell
  // `&&` can both use these
  code: number;
}

// The `check-session` / `check-prefill` commands, as a pure-ish function of
// their arguments. node.ts only prints what this returns, so the dispatch is
// testable without spawning a process.
export const runCheckCommand = async (
  command: string,
  argv: readonly string[],
  env: Env,
  deps: CheckDeps = {}
): Promise<CheckCommand> => {
  if (command === 'check-prefill') {
    const lines = await checkPrefill(env, deps);
    return { output: formatCheck(lines), code: lines.some((line) => !line.ok) ? 1 : 0 };
  }
  const token = argv[0];
  if (!token) {
    return { output: 'usage: node dist/node.js check-session <token>', code: 1 };
  }
  const lines = await checkSession(env, token, deps);
  return { output: formatCheck(lines), code: lines.some((line) => !line.ok) ? 1 : 0 };
};
