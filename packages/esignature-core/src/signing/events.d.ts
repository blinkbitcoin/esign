import type { SigningEvent } from './types';
/**
 * The proxy protocol: our mock/return-bridge pages emit
 * { event: 'signing_complete' | 'cancel' | 'decline' | 'session_timeout' | 'exception' }.
 */
export declare const interpretProxyEvent: (
  message: unknown,
) => SigningEvent | null;
/**
 * DocuSign Web Forms / signing ceremony events (shared by the API-embedded and
 * public-URL sources). Real DocuSign.js dispatches a `sessionEnd` event with
 * the outcome in a discriminator field; the exact field name isn't pinned in
 * the public docs, so we scan the plausible ones (type / sessionEndType /
 * returnValue / event / status) for a recognized outcome. Unrecognized events
 * (ready, userActivity, viewing_complete, ...) return null and are ignored.
 */
export declare const interpretDocuSignEvent: (
  message: unknown,
) => SigningEvent | null;
//# sourceMappingURL=events.d.ts.map
