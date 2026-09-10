// The signing-page postMessage bridge, as inline <script> source shipped to
// the browser inside the signing pages (pages.ts, docusign/bridge.ts), and
// the event vocabulary it carries. Kept as its own module (rather than a
// string literal buried in a page) so it has its own behavioural tests: the
// only honest way to test a string that runs as a standalone <script> is to
// actually run it, one script per `window`. DocuSign's own sessionEnd script
// is docusign/mockWebFormPage.ts.

// Posts an event to whichever host is embedding the page
export const POST_SIGNING_EVENT_SCRIPT = `
    function postSigningEvent(event) {
      var payload = JSON.stringify({ event: event });
      if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
        window.ReactNativeWebView.postMessage(payload); // React Native WebView
      } else if (window.parent && window.parent !== window) {
        window.parent.postMessage(payload, '*'); // web iframe
      }
    }`;

// Signing events the client components handle
export const CLIENT_EVENTS = [
  'signing_complete',
  'cancel',
  'decline',
  'session_timeout',
  'exception',
] as const;

export type ClientEvent = (typeof CLIENT_EVENTS)[number];
