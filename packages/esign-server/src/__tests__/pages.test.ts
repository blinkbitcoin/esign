// The embedded signing pages: they speak the postMessage protocol the client
// components listen for, under a strict nonce-based CSP, and never let a URL
// value break out of the markup.

import {
  CLIENT_EVENTS,
  LOCKED_FIELDS_HINT,
  type MockWebFormField,
  mapDocuSignReturnEvent,
  mockWebFormFields,
  renderMockSigningPage,
  renderMockWebFormPage,
  renderSigningReturnBridge,
} from '../pages';

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

describe('renderMockSigningPage', () => {
  it('speaks the full client event protocol via both host mechanisms', () => {
    const html = renderMockSigningPage('env-123');
    expect(html).toContain('window.ReactNativeWebView.postMessage');
    expect(html).toContain('window.parent.postMessage');
    for (const event of [
      'signing_complete',
      'cancel',
      'decline',
      'session_timeout',
    ]) {
      expect(html).toContain(`data-event="${event}"`);
    }
    expect(html).toContain('addEventListener');
    expect(html).toContain('Envelope env-123');
  });

  it('sanitizes envelope ids and applies the CSP nonce', () => {
    const html = renderMockSigningPage(
      '<img src=x onerror=alert(1)>',
      'nonce-xyz',
    );
    expect(html).not.toContain('<img');
    expect(html).toContain('Envelope unknown');
    expect(html).toContain('<script nonce="nonce-xyz">');
    expect(html).toContain('<style nonce="nonce-xyz">');
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

describe('renderMockWebFormPage', () => {
  it('emits the real DocuSign sessionEnd vocabulary via both hosts', () => {
    const html = renderMockWebFormPage('inst-1');
    for (const event of [
      'signingResult',
      'cancel',
      'decline',
      'sessionTimeout',
    ]) {
      expect(html).toContain(`data-event="${event}"`);
    }
    expect(html).toContain("event: 'sessionEnd'");
    expect(html).toContain('window.ReactNativeWebView.postMessage');
    expect(html).toContain('window.parent.postMessage');
    expect(html).toContain('Instance inst-1');
    expect(html).not.toContain('<form');
  });

  it('sanitizes the instance id', () => {
    expect(renderMockWebFormPage('<img onerror=alert(1)>')).toContain(
      'Instance unknown',
    );
  });

  it('renders locked fields read-only and editable fields plain, with the hint', () => {
    const fields: MockWebFormField[] = [
      { name: 'units', value: '1000', locked: true },
      { name: 'country', value: 'Honduras', locked: false },
    ];
    const html = renderMockWebFormPage('inst-1', 'n', fields);
    expect(html).toContain('<label for="field-0">units</label>');
    expect(html).toContain(
      '<input id="field-0" name="units" value="1000" readonly data-locked="true" />',
    );
    expect(html).toContain('<label for="field-1">country</label>');
    expect(html).toContain(
      '<input id="field-1" name="country" value="Honduras" />',
    );
    expect(html).toContain(`<p class="hint">${LOCKED_FIELDS_HINT}</p>`);
  });

  it('omits the hint when no field is locked', () => {
    const html = renderMockWebFormPage('inst-1', '', [
      { name: 'country', value: 'Honduras', locked: false },
    ]);
    expect(html).toContain('<form');
    expect(html).not.toContain(LOCKED_FIELDS_HINT);
  });

  it('escapes field names and values (no HTML/attribute injection)', () => {
    const html = renderMockWebFormPage('inst-1', '', [
      {
        name: 'x" onfocus="alert(1)',
        value: '<script>alert(1)</script>',
        locked: true,
      },
      { name: "it's", value: 'a & b', locked: false },
    ]);
    expect(html).not.toContain('<script>alert');
    expect(html).not.toContain('onfocus="alert');
    expect(html).toContain('x&quot; onfocus=&quot;alert(1)');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).toContain('it&#39;s');
    expect(html).toContain('a &amp; b');
  });
});

describe('mockWebFormFields', () => {
  it('locks instance prefill and keeps URL prefill editable', () => {
    expect(
      mockWebFormFields(
        { units: 1000, phone: { countryCode: '1', nationalNumber: '5551234' } },
        { country: 'Honduras' },
      ),
    ).toEqual([
      { name: 'units', value: '1000', locked: true },
      { name: 'phone', value: '+1 5551234', locked: true },
      { name: 'country', value: 'Honduras', locked: false },
    ]);
  });

  it('is empty for an unknown instance with no query', () => {
    expect(mockWebFormFields(undefined, {})).toEqual([]);
  });

  it('ignores non-string query values and lets the instance value win a name clash', () => {
    expect(
      mockWebFormFields(
        { units: 1000 },
        { units: '1', tags: ['a', 'b'], nested: { a: 1 } },
      ),
    ).toEqual([{ name: 'units', value: '1000', locked: true }]);
  });
});
