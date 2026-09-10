// Embedded signing pages a host serves (the esign service does, via the
// Express router): the mock provider's signing page and a mock hosted-form
// page renderer any provider's mock feeds its own vocabulary
// (docusign/mockWebFormPage.ts is DocuSign's). The return-URL bridge for
// real DocuSign lives in docusign/bridge.ts.
//
// The pages speak the signing-event protocol the client components listen
// for: JSON messages posted via window.ReactNativeWebView.postMessage (React
// Native WebView) or window.parent.postMessage (web iframe).

import { POST_SIGNING_EVENT_SCRIPT } from './bridge/script';
import { escapeHtml, sanitizeId } from './html';

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

// --- Mock hosted-form page -----------------------------------------------

// A field on a mock hosted-form page
export interface MockFormField {
  name: string;
  value: string;
  // Rendered read-only: the signer cannot change or clear the value
  locked: boolean;
}

// A button of the mock page: the event it posts (in the provider's own
// vocabulary) and its label
export interface MockFormButton {
  event: string;
  label: string;
  // The primary (signing) action
  primary?: boolean;
}

export interface MockFormPage {
  // <title> and heading
  title: string;
  // The document label, e.g. DEMONSTRATION WEB FORM
  label: string;
  // The instance the page stands in for (sanitized before rendering)
  instanceId: string;
  // One sentence on what the page simulates
  description: string;
  // Prefilled fields (locked ones render read-only)
  fields: MockFormField[];
  // Text shown under the fields whenever at least one is locked
  lockedHint: string;
  buttons: readonly MockFormButton[];
  // The inline script defining postSigningEvent(event) for the buttons
  script: string;
  // The CSP nonce, when the host sends one
  nonce?: string;
}

// The fields block of the mock form page (empty when there are no fields).
// Labels are linked by id rather than wrapping the input, so the accessible
// name of each input is exactly the field name (what the E2E suites query).
const renderMockFormFields = (
  fields: MockFormField[],
  lockedHint: string,
): string => {
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
    ? `<p class="hint">${lockedHint}</p>`
    : '';
  return `
  <form class="fields" autocomplete="off">
    ${rows.join('\n    ')}
    ${hint}
  </form>`;
};

// A mock hosted-form page: a provider's mock stands in for its hosted form
// with its own event vocabulary (`buttons` + `script`) and prefill rendering
// (`fields`), under the same strict CSP as every signing page.
export const renderMockFormPage = (page: MockFormPage): string => {
  const safeId = sanitizeId(page.instanceId);
  const nonceAttr = page.nonce ? ` nonce="${page.nonce}"` : '';
  const buttons = page.buttons
    .map(
      button =>
        `<button class="${button.primary ? 'sign' : 'plain'}" data-event="${button.event}">${button.label}</button>`,
    )
    .join('\n  ');
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${page.title}</title>
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
  <h1>${page.title}</h1>
  <div class="doc">
    <p><strong>${page.label}</strong></p>
    <p>Instance ${safeId}</p>
    <p>${page.description}</p>
  </div>${renderMockFormFields(page.fields, page.lockedHint)}
  ${buttons}
  <script${nonceAttr}>${page.script}
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

// --- Moved to the DocuSign adapter and the bridge script -------------------

/** @deprecated Import from './bridge/script' (ClientEvent) */
export type { ClientEvent } from './bridge/script';
/** @deprecated Import from './bridge/script' (CLIENT_EVENTS) */
export { CLIENT_EVENTS } from './bridge/script';
/** @deprecated Import from '@blinkbitcoin/esign-node/docusign' */
export {
  mapDocuSignReturnEvent,
  renderSigningReturnBridge,
} from './providers/docusign/bridge';
/** @deprecated Import from '@blinkbitcoin/esign-node/docusign' (or use MockFormField) */
export type { MockWebFormField } from './providers/docusign/mockWebFormPage';
/** @deprecated Import from '@blinkbitcoin/esign-node/docusign' */
export {
  LOCKED_FIELDS_HINT,
  mockWebFormFields,
  renderMockWebFormPage,
} from './providers/docusign/mockWebFormPage';
