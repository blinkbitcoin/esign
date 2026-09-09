// The signing-page postMessage bridge, as inline <script> source shipped to
// the browser inside the pages in ./pages.ts. Kept as its own module
// (rather than a string literal buried in pages.ts) so it has its own
// behavioural tests: the only honest way to test a string that runs as a
// standalone <script> is to actually run it, one script per `window`.

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
