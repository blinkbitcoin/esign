import { interpretDocuSignEvent, interpretProxyEvent } from '../events';
import { interpretBridgeEvent } from '../bridge';

describe('interpretDocuSignEvent', () => {
  describe('accepted shapes', () => {
    it.each([
      // DocuSign.js sessionEnd envelope, outcome in a discriminator field
      // (what the mock Web Forms page posts: { event: 'sessionEnd', type })
      [{ event: 'sessionEnd', type: 'signingResult' }, 'complete'],
      [{ event: 'sessionEnd', type: 'formConfirmation' }, 'complete'],
      [{ event: 'sessionEnd', type: 'sessionTimeout' }, 'sessionExpired'],
      [{ event: 'sessionEnd', type: 'decline' }, 'decline'],
      [{ event: 'sessionEnd', type: 'cancel' }, 'cancel'],
      [{ event: 'sessionEnd', type: 'exception' }, 'error'],
      // ...the generic alias, honoured inside the envelope only
      [{ event: 'sessionEnd', type: 'error' }, 'error'],
      [{ event: 'sessionEnd', status: 'error' }, 'error'],
      [{ event: 'sessionEnd', status: 'signingResult' }, 'complete'],
      [{ event: 'sessionEnd', sessionEndType: 'cancel' }, 'cancel'],
      // ...with sessionEnd as the type instead of the event name
      [{ type: 'sessionEnd', sessionEndType: 'signingResult' }, 'complete'],
      [{ type: 'sessionEnd', returnValue: 'signing_complete' }, 'complete'],
      [{ type: 'sessionEnd', event: 'decline' }, 'decline'],
      [{ type: 'sessionEnd', status: 'sessionTimeout' }, 'sessionExpired'],
      // The return-URL bridge ({ event }) - the five values pages.ts maps
      // DocuSign's redirect onto, delivered into a plain WebView/iframe
      [{ event: 'signing_complete' }, 'complete'],
      [{ event: 'cancel' }, 'cancel'],
      [{ event: 'decline' }, 'decline'],
      [{ event: 'session_timeout' }, 'sessionExpired'],
      [{ event: 'exception' }, 'error'],
      // A bare DocuSign vocabulary word identifies the message on its own
      [{ type: 'signingComplete' }, 'complete'],
      [{ type: 'signingResult' }, 'complete'],
      [{ event: 'signingCancel' }, 'cancel'],
      [{ type: 'cancel' }, 'cancel'],
      [{ type: 'decline' }, 'decline'],
      [{ type: 'ttl_expired' }, 'sessionExpired'],
      [{ type: 'session_timeout' }, 'sessionExpired'],
      [{ type: 'exception' }, 'error'],
      [{ returnValue: 'signing_complete' }, 'complete'],
      // The first recognized field wins over a later unrelated one
      [{ type: 'signingResult', event: 'ready' }, 'complete'],
      [{ type: 'ready', event: 'sessionEnd', status: 'cancel' }, 'cancel'],
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

    it('error carries the raw message when present', () => {
      expect(
        interpretDocuSignEvent({
          event: 'sessionEnd',
          type: 'error',
          message: 'nope',
        }),
      ).toEqual({
        type: 'error',
        code: 'SIGNING_ERROR',
        message: 'nope',
      });
      expect(interpretDocuSignEvent({ event: 'exception' })).toEqual({
        type: 'error',
        code: 'SIGNING_ERROR',
        message: undefined,
      });
    });

    it('accepts JSON-string payloads', () => {
      expect(interpretDocuSignEvent('{"type":"cancel"}')).toEqual({
        type: 'cancel',
      });
      expect(
        interpretDocuSignEvent('{"event":"sessionEnd","type":"signingResult"}'),
      ).toMatchObject({ type: 'complete' });
    });
  });

  describe('rejected shapes', () => {
    it.each([
      // Unrelated messages with no DocuSign / bridge marker must not misfire
      [{ status: 'error' }],
      [{ status: 'cancel' }],
      [{ status: 'signingResult' }],
      [{ type: 'error' }],
      [{ type: 'error', message: 'nope' }],
      [{ event: 'error' }],
      [{ sessionEndType: 'signingResult' }],
      [{ code: 'cancel' }],
      [{ type: 'cancel_', event: 'errors' }],
      // Non-terminal DocuSign events and the bare envelope
      [{ event: 'sessionEnd' }],
      [{ type: 'sessionEnd' }],
      [{ event: 'sessionEnd', type: 'ready' }],
      [{ type: 'ready' }],
      [{ type: 'userActivity' }],
      [{ type: 'viewing_complete' }],
      [{ type: 'viewing' }],
      // Non-string discriminators
      [{ type: 1 }],
      [{ event: 'sessionEnd', type: null, status: true }],
      // Prototype names are not outcomes
      [{ type: 'constructor' }],
      [{ event: 'sessionEnd', type: 'toString' }],
      [{ event: 'sessionEnd', status: 'hasOwnProperty' }],
      // Malformed / non-object input
      [{}],
      ['nope'],
      ['{"type":"error"}'],
      ['123'],
      [null],
      [undefined],
      [42],
    ])('returns null for %o', message => {
      expect(interpretDocuSignEvent(message)).toBeNull();
    });
  });
});

describe('the bridge interpreter, re-exported', () => {
  it('interpretProxyEvent is interpretBridgeEvent', () => {
    expect(interpretProxyEvent).toBe(interpretBridgeEvent);
  });
});
