// Event interpreters: translate a raw embedded-page message into a normalized
// SigningEvent. Pure functions, platform-agnostic, one per event protocol.

import type { SigningEvent } from './types';

// Parse a raw message (object or JSON string) into a plain record, or null.
const asRecord = (message: unknown): Record<string, unknown> | null => {
  if (typeof message === 'string') {
    try {
      const parsed = JSON.parse(message);
      return parsed && typeof parsed === 'object'
        ? (parsed as Record<string, unknown>)
        : null;
    } catch {
      return null;
    }
  }
  return message && typeof message === 'object'
    ? (message as Record<string, unknown>)
    : null;
};

/**
 * The proxy protocol: our mock/return-bridge pages emit
 * { event: 'signing_complete' | 'cancel' | 'decline' | 'session_timeout' | 'exception' }.
 */
export const interpretProxyEvent = (message: unknown): SigningEvent | null => {
  const data = asRecord(message);
  if (!data || typeof data.event !== 'string') {
    return null;
  }
  switch (data.event) {
    case 'signing_complete':
      return { type: 'complete' };
    case 'cancel':
      return { type: 'cancel' };
    case 'decline':
      return { type: 'decline' };
    case 'session_timeout':
      return { type: 'sessionExpired' };
    case 'exception':
      return {
        type: 'error',
        code: 'SIGNING_ERROR',
        message: typeof data.message === 'string' ? data.message : undefined,
      };
    default:
      return null;
  }
};

const str = (value: unknown): string | undefined =>
  typeof value === 'string' ? value : undefined;

// DocuSign outcome vocabulary → normalized event type. Verified against the
// DocuSign Web Forms / DocuSign.js docs (2026-07): real integrations deliver a
// single `sessionEnd` event whose OUTCOME is a discriminator - `signingResult`
// / `formConfirmation` (done), `sessionTimeout` (timeout). The eSignature
// ceremony uses returnValue-style values (signing_complete, decline, ...). We
// accept all of them (the `sessionEnd` wrapper itself is ignored - it's the
// envelope, not the outcome).
const DOCUSIGN_OUTCOME: Record<string, SigningEvent['type']> = {
  signingResult: 'complete',
  formConfirmation: 'complete',
  signing_complete: 'complete',
  signingComplete: 'complete',
  sessionTimeout: 'sessionExpired',
  session_timeout: 'sessionExpired',
  ttl_expired: 'sessionExpired',
  cancel: 'cancel',
  signingCancel: 'cancel',
  decline: 'decline',
  exception: 'error',
  error: 'error',
};

/**
 * DocuSign Web Forms / signing ceremony events (shared by the API-embedded and
 * public-URL sources). Real DocuSign.js dispatches a `sessionEnd` event with
 * the outcome in a discriminator field; the exact field name isn't pinned in
 * the public docs, so we scan the plausible ones (type / sessionEndType /
 * returnValue / event / status) for a recognized outcome. Unrecognized events
 * (ready, userActivity, viewing_complete, ...) return null and are ignored.
 */
export const interpretDocuSignEvent = (
  message: unknown,
): SigningEvent | null => {
  const data = asRecord(message);
  if (!data) {
    return null;
  }
  const candidates = [
    data.type,
    data.sessionEndType,
    data.returnValue,
    data.event,
    data.status,
  ];
  for (const candidate of candidates) {
    const key = str(candidate);
    const outcome = key ? DOCUSIGN_OUTCOME[key] : undefined;
    if (!outcome) {
      continue;
    }
    if (outcome === 'complete') {
      return { type: 'complete', envelopeId: str(data.envelopeId) };
    }
    if (outcome === 'error') {
      return {
        type: 'error',
        code: 'SIGNING_ERROR',
        message: str(data.message),
      };
    }
    return { type: outcome };
  }
  return null;
};
