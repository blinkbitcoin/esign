// The return-URL bridge for real DocuSign: maps the redirect's event onto
// the client protocol and forwards it as a postMessage under the nonce CSP,
// never letting a URL value break out of the markup.

import { CLIENT_EVENTS } from '../../bridge/script';
import { mapDocuSignReturnEvent, renderSigningReturnBridge } from '../bridge';

describe('mapDocuSignReturnEvent', () => {
  it.each([
    ['signing_complete', 'signing_complete'],
    ['cancel', 'cancel'],
    ['decline', 'decline'],
    ['session_timeout', 'session_timeout'],
    ['ttl_expired', 'session_timeout'],
  ])('maps DocuSign %s to %s', (docusign, ours) => {
    expect(mapDocuSignReturnEvent(docusign)).toBe(ours);
  });

  it('maps unknown, missing and malicious values to exception', () => {
    expect(mapDocuSignReturnEvent('viewing_complete')).toBe('exception');
    expect(mapDocuSignReturnEvent(undefined)).toBe('exception');
    expect(mapDocuSignReturnEvent('<script>alert(1)</script>')).toBe(
      'exception',
    );
  });

  it('only ever returns events the client components handle', () => {
    for (const raw of ['signing_complete', 'ttl_expired', 'garbage', '']) {
      expect(CLIENT_EVENTS).toContain(mapDocuSignReturnEvent(raw));
    }
  });
});

describe('renderSigningReturnBridge', () => {
  it('forwards the mapped event as a postMessage on load', () => {
    const html = renderSigningReturnBridge('signing_complete');
    expect(html).toContain('postSigningEvent("signing_complete")');
    expect(html).toContain('window.ReactNativeWebView.postMessage');
    expect(html).toContain('window.parent.postMessage');
    expect(html).toContain('<title>Signing Complete</title>');
  });

  it('never interpolates raw query input, and escapes < in the embedded JSON', () => {
    const html = renderSigningReturnBridge(
      '"></script><script>alert(1)</script>',
      'n',
    );
    expect(html).not.toContain('alert(1)');
    expect(html).toContain('postSigningEvent("exception")');
    expect(html).toContain('<title>Signing Finished</title>');
    expect(html).toContain('<script nonce="n">');
  });
});
