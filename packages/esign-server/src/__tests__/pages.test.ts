// The embedded signing pages: they speak the postMessage protocol the client
// components listen for, under a strict nonce-based CSP, and never let a URL
// value break out of the markup. (DocuSign's bridge and mock Web Forms page
// are tested under docusign/__tests__.)

import {
  type MockFormPage,
  renderMockFormPage,
  renderMockSigningPage,
} from '../pages';

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

describe('renderMockFormPage', () => {
  const page: MockFormPage = {
    title: 'Mock Form',
    label: 'DEMONSTRATION FORM',
    instanceId: 'inst-1',
    description: 'A provider-neutral mock.',
    fields: [],
    lockedHint: 'Locked.',
    buttons: [
      { event: 'done', label: 'Finish', primary: true },
      { event: 'quit', label: 'Leave' },
    ],
    script: 'function postSigningEvent(e) {}',
  };

  it('renders the provider vocabulary it is given, with no fields block when empty', () => {
    const html = renderMockFormPage(page);
    expect(html).toContain('<title>Mock Form</title>');
    expect(html).toContain('<h1>Mock Form</h1>');
    expect(html).toContain('<strong>DEMONSTRATION FORM</strong>');
    expect(html).toContain('Instance inst-1');
    expect(html).toContain('A provider-neutral mock.');
    expect(html).toContain(
      '<button class="sign" data-event="done">Finish</button>',
    );
    expect(html).toContain(
      '<button class="plain" data-event="quit">Leave</button>',
    );
    expect(html).toContain('function postSigningEvent(e) {}');
    expect(html).not.toContain('<form');
    expect(html).toContain('<script>');
  });

  it('sanitizes the instance id, applies the nonce and the locked hint', () => {
    const html = renderMockFormPage({
      ...page,
      instanceId: '<img onerror=alert(1)>',
      nonce: 'n',
      fields: [{ name: 'units', value: '1', locked: true }],
    });
    expect(html).toContain('Instance unknown');
    expect(html).toContain('<script nonce="n">');
    expect(html).toContain('<p class="hint">Locked.</p>');
    expect(html).toContain(
      '<input id="field-0" name="units" value="1" readonly data-locked="true" />',
    );
  });
});
