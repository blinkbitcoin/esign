// The postMessage origin guard: a session may pin the origin its signing
// page posts from (SigningSession.allowedOrigin). Web only in practice - a
// React Native WebView message carries no origin - but the rule itself is
// platform-agnostic, so it lives here and is tested once.

import type { SigningSession } from './types';

/**
 * True when a message from `origin` may drive the signing flow: the session
 * pins no origin (any sender is accepted - fine for local dev), or the
 * sender's origin is exactly the pinned one. No session, no pin.
 */
export const isAllowedOrigin = (
  session: Pick<SigningSession, 'allowedOrigin'> | null | undefined,
  origin: string,
): boolean => {
  const allowedOrigin = session?.allowedOrigin;
  return !allowedOrigin || origin === allowedOrigin;
};
