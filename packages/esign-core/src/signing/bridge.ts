// The bridge protocol: the provider-neutral `{ event }` envelope our return-URL
// bridge and mock pages post into the WebView/iframe. Pure, platform-agnostic.

import type { SigningEvent } from './types';

/** Parse a raw page message (object or JSON string) into a plain record, or null. */
export const asRecord = (message: unknown): Record<string, unknown> | null => {
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
 * The bridge protocol: our mock/return-bridge pages emit
 * { event: 'signing_complete' | 'cancel' | 'decline' | 'session_timeout' | 'exception' }.
 */
export const interpretBridgeEvent = (message: unknown): SigningEvent | null => {
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

/** @deprecated Import `interpretBridgeEvent` from '@blinkbitcoin/esign-core' */
export const interpretProxyEvent = interpretBridgeEvent;
