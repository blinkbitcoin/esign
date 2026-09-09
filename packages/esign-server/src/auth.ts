// The one piece of request authentication every host repeats: reading the
// token out of `Authorization: Bearer <token>`. What the token means (a
// session id, a JWT to verify, a user id in a demo) stays the host's.

const BEARER_PREFIX = 'Bearer ';

// The bearer token of an Authorization header, or null when the header is
// missing, not a Bearer scheme, or carries no token
export const bearerToken = (
  header: string | null | undefined,
): string | null => {
  if (!header?.startsWith(BEARER_PREFIX)) {
    return null;
  }
  const token = header.slice(BEARER_PREFIX.length).trim();
  return token || null;
};
