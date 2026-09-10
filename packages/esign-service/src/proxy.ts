// Who the client is, when something forwards for us.
//
// `x-forwarded-for` is a request header: any caller can set it. It may only
// be believed when the deployment says a proxy it trusts sits in front and
// rewrites it - which is what TRUST_PROXY declares. Both places that need a
// client address (the Node server's rate-limit key and the webhook's
// security logging) go through here, so one deployment cannot trust the
// header for one and not the other.

import type { Env } from './env';

export const TRUST_PROXY = 'TRUST_PROXY';

// Does this deployment sit behind a proxy it trusts?
export const trustsProxy = (env: Env): boolean => env[TRUST_PROXY] === 'true';

// The client address a trusted proxy reported (the first entry of the
// forwarded chain), or undefined - because there is no proxy, because the
// deployment does not trust one, or because the header is absent.
export const forwardedClientIp = (request: Request, trustProxy: boolean): string | undefined =>
  trustProxy
    ? request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || undefined
    : undefined;
