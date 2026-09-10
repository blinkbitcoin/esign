// The mock Web Forms page: stands in for a DocuSign Web Forms instance so the
// full Web Forms flow is exercisable without DocuSign credentials. It emits
// the REAL DocuSign event names ({ type: 'signingResult' | 'signingCancel' |
// 'decline' | 'ttl_expired' }), so a green E2E here proves the actual
// protocol. The page itself is the neutral mock-form renderer (pages.ts)
// fed DocuSign's vocabulary, script and prefill rendering.

import { type MockFormField, renderMockFormPage } from '../../pages';
import { formatPrefillValue } from './prefill';
import type { WebFormPrefill } from './types';

// Posts a DocuSign.js-shaped sessionEnd event ({ event: 'sessionEnd', type }) -
// the real shape DocuSign.js dispatches (verified 2026-07: sessionEnd with a
// type discriminator). Kept distinct from POST_SIGNING_EVENT_SCRIPT so the Web
// Forms mock exercises the REAL event vocabulary (interpretDocuSignEvent), not
// the proxy's.
export const POST_SESSION_END_SCRIPT = `
    function postSigningEvent(type) {
      var payload = JSON.stringify({ event: 'sessionEnd', type: type });
      if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
        window.ReactNativeWebView.postMessage(payload); // React Native WebView
      } else if (window.parent && window.parent !== window) {
        window.parent.postMessage(payload, '*'); // web iframe
      }
    }`;

// A field on the mock Web Forms page
export type MockWebFormField = MockFormField;

// Text shown under the fields whenever at least one is locked (asserted by
// the browser/mobile E2E suites)
export const LOCKED_FIELDS_HINT =
  'Locked fields were set by the sender and cannot be edited.';

// The buttons, in DocuSign.js's sessionEnd vocabulary
const BUTTONS = [
  { event: 'signingResult', label: 'Complete Signing', primary: true },
  { event: 'cancel', label: 'Cancel' },
  { event: 'decline', label: 'Decline to Sign' },
  { event: 'sessionTimeout', label: 'Simulate Session Timeout' },
] as const;

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

// The mock Web Forms page for an instance; `fields` renders the instance's
// prefill (see mockWebFormFields).
export const renderMockWebFormPage = (
  instanceId: string,
  nonce = '',
  fields: MockWebFormField[] = [],
): string =>
  renderMockFormPage({
    title: 'Mock Web Form',
    label: 'DEMONSTRATION WEB FORM',
    instanceId,
    description:
      'This page simulates a DocuSign Web Forms instance (prefilled + signable).',
    fields,
    lockedHint: LOCKED_FIELDS_HINT,
    buttons: BUTTONS,
    script: POST_SESSION_END_SCRIPT,
    nonce,
  });
