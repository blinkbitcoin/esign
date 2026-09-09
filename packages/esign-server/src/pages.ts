// Embedded signing pages a host serves (the esign service does, via the
// Express router): the mock provider's pages and the real-DocuSign
// return-URL bridge.
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

import { escapeHtml, jsonForScript, sanitizeId } from './html';
import {
  POST_SESSION_END_SCRIPT,
  POST_SIGNING_EVENT_SCRIPT,
} from './bridgeScript';
import { formatPrefillValue } from './prefill';
import type { WebFormPrefill } from './types';

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
export const mapDocuSignReturnEvent = (
  raw: string | undefined,
): ClientEvent => {
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

// The mock provider's signing page: interactive, so manual testing and
// Maestro E2E exercise the real WebView/iframe -> postMessage path.
export const renderMockSigningPage = (
  envelopeId: string,
  nonce = '',
): string => {
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
  <script${nonceAttr}>${POST_SIGNING_EVENT_SCRIPT}
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

// A field on the mock Web Forms page
export interface MockWebFormField {
  name: string;
  value: string;
  // Rendered read-only: the signer cannot change or clear the value
  locked: boolean;
}

// Text shown under the fields whenever at least one is locked (asserted by
// the browser/mobile E2E suites)
export const LOCKED_FIELDS_HINT =
  'Locked fields were set by the sender and cannot be edited.';

// Fields for the mock web-form page, mirroring how DocuSign Web Forms treats
// the two prefill channels (verified 2026-09):
//   - values minted with the instance (createInstance formValues) can populate
//     read-only fields - the signer sees them but cannot change them;
//   - values arriving in the URL (prefill by URL) only ever land in editable
//     fields - they cannot populate a read-only field.
// So: instance prefill → locked; query-string prefill → editable. A name
// present in both is locked (the sender's value wins).
export const mockWebFormFields = (
  instancePrefill: WebFormPrefill | undefined,
  query: Record<string, unknown>,
): MockWebFormField[] => {
  const locked = Object.entries(instancePrefill ?? {}).map(([name, value]) => ({
    name,
    value: formatPrefillValue(value),
    locked: true,
  }));
  const lockedNames = new Set(locked.map(field => field.name));
  const editable = Object.entries(query).flatMap(([name, value]) =>
    typeof value === 'string' && !lockedNames.has(name)
      ? [{ name, value, locked: false }]
      : [],
  );
  return [...locked, ...editable];
};

// The fields block of the mock web-form page (empty when there are no fields).
// Labels are linked by id rather than wrapping the input, so the accessible
// name of each input is exactly the field name (what the E2E suites query).
const renderMockWebFormFields = (fields: MockWebFormField[]): string => {
  if (fields.length === 0) {
    return '';
  }
  const rows = fields.map((field, index) => {
    const id = `field-${index}`;
    const lockedAttrs = field.locked ? ' readonly data-locked="true"' : '';
    return `<div class="field">
      <label for="${id}">${escapeHtml(field.name)}</label>
      <input id="${id}" name="${escapeHtml(field.name)}" value="${escapeHtml(field.value)}"${lockedAttrs} />
    </div>`;
  });
  const hint = fields.some(field => field.locked)
    ? `<p class="hint">${LOCKED_FIELDS_HINT}</p>`
    : '';
  return `
  <form class="fields" autocomplete="off">
    ${rows.join('\n    ')}
    ${hint}
  </form>`;
};

// The mock Web Forms page: stands in for a DocuSign Web Forms instance so the
// full Web Forms flow is exercisable without DocuSign credentials. It emits the
// REAL DocuSign event names ({ type: 'signingComplete' | 'signingCancel' |
// 'decline' | 'ttl_expired' }), so a green E2E here proves the actual protocol.
// `fields` renders the instance's prefill (see mockWebFormFields).
export const renderMockWebFormPage = (
  instanceId: string,
  nonce = '',
  fields: MockWebFormField[] = [],
): string => {
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
    .fields { max-width: 420px; margin: 16px auto; text-align: left; }
    .field { margin: 8px 0; }
    .field label { display: block; font-size: 14px; color: #444; margin-bottom: 4px; }
    .field input { width: 100%; box-sizing: border-box; padding: 10px; font-size: 16px; border: 1px solid #ccc; border-radius: 6px; }
    .field input[readonly] { background: #f2f2f2; color: #666; }
    .hint { font-size: 13px; color: #666; }
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
  </div>${renderMockWebFormFields(fields)}
  <button class="sign" data-event="signingResult">Complete Signing</button>
  <button class="plain" data-event="cancel">Cancel</button>
  <button class="plain" data-event="decline">Decline to Sign</button>
  <button class="plain" data-event="sessionTimeout">Simulate Session Timeout</button>
  <script${nonceAttr}>${POST_SESSION_END_SCRIPT}
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
export const renderSigningReturnBridge = (
  rawEvent: string | undefined,
  nonce = '',
): string => {
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
  <script${nonceAttr}>${POST_SIGNING_EVENT_SCRIPT}
    postSigningEvent(${jsonForScript(event)});
  </script>
</body>
</html>
`;
};
