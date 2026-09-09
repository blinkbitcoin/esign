import { interpretBridgeEvent, interpretProxyEvent } from '../bridge';

describe('interpretBridgeEvent', () => {
  it.each([
    ['signing_complete', 'complete'],
    ['cancel', 'cancel'],
    ['decline', 'decline'],
    ['session_timeout', 'sessionExpired'],
  ])('maps %s to %s', (event, type) => {
    expect(interpretBridgeEvent({ event })).toMatchObject({ type });
  });

  it('maps exception to a normalized error with the raw message', () => {
    expect(
      interpretBridgeEvent({ event: 'exception', message: 'boom' }),
    ).toEqual({
      type: 'error',
      code: 'SIGNING_ERROR',
      message: 'boom',
    });
  });

  it('exception without a string message omits the message', () => {
    expect(interpretBridgeEvent({ event: 'exception' })).toEqual({
      type: 'error',
      code: 'SIGNING_ERROR',
      message: undefined,
    });
  });

  it('accepts JSON-string payloads', () => {
    expect(interpretBridgeEvent('{"event":"cancel"}')).toEqual({
      type: 'cancel',
    });
  });

  it('returns null for unknown, malformed, or non-object input', () => {
    expect(interpretBridgeEvent({ event: 'whatever' })).toBeNull();
    expect(interpretBridgeEvent({ nope: true })).toBeNull();
    expect(interpretBridgeEvent('not json')).toBeNull();
    expect(interpretBridgeEvent('123')).toBeNull(); // parses to a number, not an object
    expect(interpretBridgeEvent(null)).toBeNull();
    expect(interpretBridgeEvent(42)).toBeNull();
  });
});

describe('interpretProxyEvent', () => {
  it('is the deprecated name of interpretBridgeEvent', () => {
    expect(interpretProxyEvent).toBe(interpretBridgeEvent);
  });
});
