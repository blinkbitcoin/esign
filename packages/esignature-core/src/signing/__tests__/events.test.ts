import { interpretProxyEvent, interpretDocuSignEvent } from '../events';

describe('interpretProxyEvent', () => {
  it.each([
    ['signing_complete', 'complete'],
    ['cancel', 'cancel'],
    ['decline', 'decline'],
    ['session_timeout', 'sessionExpired'],
  ])('maps %s to %s', (event, type) => {
    expect(interpretProxyEvent({ event })).toMatchObject({ type });
  });

  it('maps exception to a normalized error with the raw message', () => {
    expect(
      interpretProxyEvent({ event: 'exception', message: 'boom' }),
    ).toEqual({
      type: 'error',
      code: 'SIGNING_ERROR',
      message: 'boom',
    });
  });

  it('exception without a string message omits the message', () => {
    expect(interpretProxyEvent({ event: 'exception' })).toEqual({
      type: 'error',
      code: 'SIGNING_ERROR',
      message: undefined,
    });
  });

  it('accepts JSON-string payloads', () => {
    expect(interpretProxyEvent('{"event":"cancel"}')).toEqual({
      type: 'cancel',
    });
  });

  it('returns null for unknown, malformed, or non-object input', () => {
    expect(interpretProxyEvent({ event: 'whatever' })).toBeNull();
    expect(interpretProxyEvent({ nope: true })).toBeNull();
    expect(interpretProxyEvent('not json')).toBeNull();
    expect(interpretProxyEvent('123')).toBeNull(); // parses to a number, not an object
    expect(interpretProxyEvent(null)).toBeNull();
    expect(interpretProxyEvent(42)).toBeNull();
  });
});

describe('interpretDocuSignEvent', () => {
  it.each([
    // Real DocuSign.js sessionEnd shapes (outcome in a discriminator field)
    [{ event: 'sessionEnd', type: 'signingResult' }, 'complete'],
    [{ event: 'sessionEnd', type: 'formConfirmation' }, 'complete'],
    [{ type: 'sessionEnd', sessionEndType: 'signingResult' }, 'complete'],
    [{ type: 'sessionEnd', returnValue: 'signing_complete' }, 'complete'],
    [{ event: 'sessionEnd', type: 'sessionTimeout' }, 'sessionExpired'],
    [{ event: 'sessionEnd', type: 'decline' }, 'decline'],
    [{ event: 'sessionEnd', type: 'cancel' }, 'cancel'],
    // Direct / legacy shapes still accepted
    [{ type: 'signingComplete' }, 'complete'],
    [{ event: 'signing_complete' }, 'complete'],
    [{ type: 'cancel' }, 'cancel'],
    [{ event: 'signingCancel' }, 'cancel'],
    [{ type: 'decline' }, 'decline'],
    [{ type: 'ttl_expired' }, 'sessionExpired'],
    [{ type: 'session_timeout' }, 'sessionExpired'],
    [{ type: 'error' }, 'error'],
    [{ event: 'exception' }, 'error'],
  ])('maps %o to %s', (message, type) => {
    expect(interpretDocuSignEvent(message)).toMatchObject({ type });
  });

  it('carries envelopeId through the completion event', () => {
    expect(
      interpretDocuSignEvent({
        event: 'sessionEnd',
        type: 'signingResult',
        envelopeId: 'env-9',
      }),
    ).toEqual({
      type: 'complete',
      envelopeId: 'env-9',
    });
  });

  it('completion without an envelopeId leaves it undefined', () => {
    expect(interpretDocuSignEvent({ type: 'signingComplete' })).toEqual({
      type: 'complete',
      envelopeId: undefined,
    });
  });

  it('ignores the bare sessionEnd wrapper and non-terminal events', () => {
    // sessionEnd with no recognized outcome, plus ready/userActivity
    expect(interpretDocuSignEvent({ event: 'sessionEnd' })).toBeNull();
    expect(interpretDocuSignEvent({ type: 'ready' })).toBeNull();
    expect(interpretDocuSignEvent({ type: 'userActivity' })).toBeNull();
  });

  it('error carries the raw message when present', () => {
    expect(interpretDocuSignEvent({ type: 'error', message: 'nope' })).toEqual({
      type: 'error',
      code: 'SIGNING_ERROR',
      message: 'nope',
    });
  });

  it('accepts JSON strings and ignores unrecognized / malformed input', () => {
    expect(interpretDocuSignEvent('{"type":"cancel"}')).toEqual({
      type: 'cancel',
    });
    expect(interpretDocuSignEvent({ type: 'viewing' })).toBeNull();
    expect(interpretDocuSignEvent({})).toBeNull();
    expect(interpretDocuSignEvent('nope')).toBeNull();
    expect(interpretDocuSignEvent(null)).toBeNull();
  });
});
