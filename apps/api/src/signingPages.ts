// Embedded signing pages served by the backend.
//
// Both pages speak the signing-event protocol the client components listen
// for: JSON messages posted via window.ReactNativeWebView.postMessage (React
// Native WebView) or window.parent.postMessage (web iframe).
//
// - renderMockSigningPage: the mock provider's interactive signing page, so
//   the full embedded flow is exercisable without DocuSign credentials.
// - renderSigningReturnBridge: translates REAL DocuSign's protocol (a
//   redirect to DOCUSIGN_RETURN_URL with an `event` query param) into the
//   postMessage protocol. DocuSign's embedded signing never postMessages.

// Signing events the client components handle
export const CLIENT_EVENTS = [
  'signing_complete',
  'cancel',
  'decline',
  'session_timeout',
  'exception',
] as const;

export type ClientEvent = (typeof CLIENT_EVENTS)[number];

// Map DocuSign return-URL event values onto the client protocol.
// https://developers.docusign.com/docs/esign-rest-api/ (embedded signing
// ceremony redirect events). Unknown/missing values map to 'exception' -
// never trust a query param.
export const mapDocuSignReturnEvent = (raw: string | undefined): ClientEvent => {
  switch (raw) {
    case 'signing_complete':
      return 'signing_complete';
    case 'cancel':
      return 'cancel';
    case 'decline':
      return 'decline';
    case 'session_timeout':
    case 'ttl_expired':
      return 'session_timeout';
    default:
      return 'exception';
  }
};

// Posts an event to whichever host is embedding the page
const POST_HELPER = `
    function postSigningEvent(event) {
      var payload = JSON.stringify({ event: event });
      if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
        window.ReactNativeWebView.postMessage(payload); // React Native WebView
      } else if (window.parent && window.parent !== window) {
        window.parent.postMessage(payload, '*'); // web iframe
      }
    }`;

// Strict allow-list sanitization for values interpolated into HTML/JS
const sanitizeId = (value: string): string =>
  /^[a-zA-Z0-9-]{1,64}$/.test(value) ? value : 'unknown';

// JSON for embedding inside a <script> block. JSON.stringify does not escape
// '<' or '/', so a value containing '</script>' could otherwise break out.
// Escaping '<' to < closes that hole even if a raw value ever reaches
// this sink (defense in depth - callers already pass fixed enum values).
const jsonForScript = (value: unknown): string => JSON.stringify(value).replace(/</g, '\\u003c');

// The mock provider's signing page: interactive, so manual testing and
// Maestro E2E exercise the real WebView/iframe -> postMessage path.
export const renderMockSigningPage = (envelopeId: string, nonce = ''): string => {
  const safeId = sanitizeId(envelopeId);
  const nonceAttr = nonce ? ` nonce="${nonce}"` : '';
  // Buttons carry their event in data-event (no inline onclick) so the page
  // works under a strict, nonce-based CSP with no 'unsafe-inline'.
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Mock Signing</title>
  <style${nonceAttr}>
    body { font-family: system-ui, sans-serif; margin: 0; padding: 24px; text-align: center; }
    h1 { font-size: 20px; }
    .doc { border: 1px solid #ccc; border-radius: 8px; padding: 16px; margin: 16px auto; max-width: 420px; color: #444; }
    button { display: block; width: 100%; max-width: 420px; margin: 8px auto; padding: 14px; font-size: 16px; border-radius: 8px; border: none; cursor: pointer; }
    .sign { background: #007aff; color: #fff; font-weight: 600; }
    .plain { background: #eee; color: #333; }
  </style>
</head>
<body>
  <h1>Mock Signing Session</h1>
  <div class="doc">
    <p><strong>DEMONSTRATION DOCUMENT</strong></p>
    <p>Envelope ${safeId}</p>
    <p>This page simulates the e-sign provider's embedded signing ceremony.</p>
  </div>
  <button class="sign" data-event="signing_complete">Complete Signing</button>
  <button class="plain" data-event="cancel">Cancel</button>
  <button class="plain" data-event="decline">Decline to Sign</button>
  <button class="plain" data-event="session_timeout">Simulate Session Timeout</button>
  <script${nonceAttr}>${POST_HELPER}
    document.querySelectorAll('button[data-event]').forEach(function (el) {
      el.addEventListener('click', function () {
        postSigningEvent(el.getAttribute('data-event'));
      });
    });
  </script>
</body>
</html>
`;
};

// Posts a DocuSign.js-shaped sessionEnd event ({ event: 'sessionEnd', type }) -
// the real shape DocuSign.js dispatches (verified 2026-07: sessionEnd with a
// type discriminator). Kept distinct from POST_HELPER so the Web Forms mock
// exercises the REAL event vocabulary (interpretDocuSignEvent), not the proxy's.
const POST_HELPER_TYPE = `
    function postSigningEvent(type) {
      var payload = JSON.stringify({ event: 'sessionEnd', type: type });
      if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
        window.ReactNativeWebView.postMessage(payload); // React Native WebView
      } else if (window.parent && window.parent !== window) {
        window.parent.postMessage(payload, '*'); // web iframe
      }
    }`;

// The mock Web Forms page: stands in for a DocuSign Web Forms instance so the
// full Web Forms flow is exercisable without DocuSign credentials. It emits the
// REAL DocuSign event names ({ type: 'signingComplete' | 'signingCancel' |
// 'decline' | 'ttl_expired' }), so a green E2E here proves the actual protocol.
export const renderMockWebFormPage = (instanceId: string, nonce = ''): string => {
  const safeId = sanitizeId(instanceId);
  const nonceAttr = nonce ? ` nonce="${nonce}"` : '';
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Mock Web Form</title>
  <style${nonceAttr}>
    body { font-family: system-ui, sans-serif; margin: 0; padding: 24px; text-align: center; }
    h1 { font-size: 20px; }
    .doc { border: 1px solid #ccc; border-radius: 8px; padding: 16px; margin: 16px auto; max-width: 420px; color: #444; }
    button { display: block; width: 100%; max-width: 420px; margin: 8px auto; padding: 14px; font-size: 16px; border-radius: 8px; border: none; cursor: pointer; }
    .sign { background: #007aff; color: #fff; font-weight: 600; }
    .plain { background: #eee; color: #333; }
  </style>
</head>
<body>
  <h1>Mock Web Form</h1>
  <div class="doc">
    <p><strong>DEMONSTRATION WEB FORM</strong></p>
    <p>Instance ${safeId}</p>
    <p>This page simulates a DocuSign Web Forms instance (prefilled + signable).</p>
  </div>
  <button class="sign" data-event="signingResult">Complete Signing</button>
  <button class="plain" data-event="cancel">Cancel</button>
  <button class="plain" data-event="decline">Decline to Sign</button>
  <button class="plain" data-event="sessionTimeout">Simulate Session Timeout</button>
  <script${nonceAttr}>${POST_HELPER_TYPE}
    document.querySelectorAll('button[data-event]').forEach(function (el) {
      el.addEventListener('click', function () {
        postSigningEvent(el.getAttribute('data-event'));
      });
    });
  </script>
</body>
</html>
`;
};

// The return-URL bridge for REAL DocuSign: DocuSign redirects the embedded
// page here with ?event=...; this page forwards it as a postMessage so the
// client components see the same protocol the mock speaks natively.
export const renderSigningReturnBridge = (rawEvent: string | undefined, nonce = ''): string => {
  const event = mapDocuSignReturnEvent(rawEvent);
  const nonceAttr = nonce ? ` nonce="${nonce}"` : '';
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Signing ${event === 'signing_complete' ? 'Complete' : 'Finished'}</title>
  <style${nonceAttr}>
    body { font-family: system-ui, sans-serif; margin: 0; padding: 48px 24px; text-align: center; color: #444; }
  </style>
</head>
<body>
  <p>Returning to the app&hellip;</p>
  <script${nonceAttr}>${POST_HELPER}
    postSigningEvent(${jsonForScript(event)});
  </script>
</body>
</html>
`;
};
