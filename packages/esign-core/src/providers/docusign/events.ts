// The DocuSign event interpreter: translates a raw embedded-page message into
// a normalized SigningEvent. Pure, platform-agnostic.

import { asRecord } from '../../signing/bridge';

import type { SigningEvent } from '../../signing/types';

const str = (value: unknown): string | undefined =>
  typeof value === 'string' ? value : undefined;

// DocuSign outcome vocabulary → normalized event type. Verified against the
// DocuSign Web Forms / DocuSign.js docs (2026-07): real integrations deliver a
// single `sessionEnd` event whose OUTCOME is a discriminator - `signingResult`
// / `formConfirmation` (done), `sessionTimeout` (timeout). The eSignature
// ceremony uses returnValue-style values (signing_complete, decline, ...),
// which the return-URL bridge forwards as `{ event }`. A word from this
// vocabulary is what marks a message as DocuSign's / the bridge's - so it is
// keyed in a Map (no prototype names leaking in as "outcomes").
const DOCUSIGN_OUTCOME = new Map<string, SigningEvent['type']>([
  ['signingResult', 'complete'],
  ['formConfirmation', 'complete'],
  ['signing_complete', 'complete'],
  ['signingComplete', 'complete'],
  ['sessionTimeout', 'sessionExpired'],
  ['session_timeout', 'sessionExpired'],
  ['ttl_expired', 'sessionExpired'],
  ['cancel', 'cancel'],
  ['signingCancel', 'cancel'],
  ['decline', 'decline'],
  ['exception', 'error'],
]);

// Generic aliases DocuSign does not use itself: honoured only inside a
// DocuSign.js `sessionEnd` envelope, never as a bare `{ type: 'error' }` (any
// other embed, extension or devtool could post that).
const ENVELOPE_ONLY_OUTCOME = new Map<string, SigningEvent['type']>([
  ['error', 'error'],
]);

// The DocuSign.js envelope: `sessionEnd` as the event name or the type, with
// the outcome in a sibling discriminator field.
const isSessionEndEnvelope = (data: Record<string, unknown>): boolean =>
  data.event === 'sessionEnd' || data.type === 'sessionEnd';

/**
 * DocuSign Web Forms / signing ceremony events (shared by the API-embedded and
 * public-URL sources). Accepts the two real shapes - DocuSign.js's `sessionEnd`
 * envelope (the discriminator field isn't pinned in the public docs, so type /
 * sessionEndType / returnValue / event / status are all read) and the
 * return-URL bridge's `{ event }` - plus a bare DocuSign vocabulary word in
 * type / returnValue / event. A message that carries neither the envelope nor
 * a DocuSign word (an unrelated `{ status: 'error' }` or `{ type: 'error' }`,
 * a non-terminal ready / userActivity / viewing_complete) returns null.
 */
export const interpretDocuSignEvent = (
  message: unknown,
): SigningEvent | null => {
  const data = asRecord(message);
  if (!data) {
    return null;
  }
  const envelope = isSessionEndEnvelope(data);
  // Outside the envelope only the fields DocuSign / the bridge name the
  // outcome in are read; `sessionEndType` / `status` are envelope-only.
  const candidates = envelope
    ? [
        data.type,
        data.sessionEndType,
        data.returnValue,
        data.event,
        data.status,
      ]
    : [data.type, data.returnValue, data.event];
  for (const candidate of candidates) {
    const key = str(candidate);
    if (key === undefined) {
      continue;
    }
    const outcome =
      DOCUSIGN_OUTCOME.get(key) ??
      (envelope ? ENVELOPE_ONLY_OUTCOME.get(key) : undefined);
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
