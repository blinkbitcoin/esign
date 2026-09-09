// The signing pages (mock pages + the real-DocuSign return-URL bridge) are
// HTML meant to be embedded (WebView/iframe) and run a small inline script.
// A per-response nonce keeps a strict CSP (no 'unsafe-inline') while
// allowing that one script. frame-ancestors stays open: the pages carry no
// secrets (the event payload is a fixed enum) and must be embeddable by any
// host integrating the SDK. The Express router and a host's own route (the
// bridge a mint-only host serves itself) send the pages the same way.

import { randomBytes } from 'node:crypto';

// The Content-Security-Policy value for a signing page rendered with `nonce`
export const signingPageCsp = (nonce: string): string =>
  [
    "default-src 'none'",
    `script-src 'nonce-${nonce}'`,
    `style-src 'nonce-${nonce}'`,
    'frame-ancestors *',
  ].join('; ');

// A fresh per-response nonce
export const signingPageNonce = (): string =>
  randomBytes(16).toString('base64');

// A signing page as a Fetch API Response: `render` gets the nonce the CSP
// allows (renderSigningReturnBridge, renderMockSigningPage, ...)
export const signingPageResponse = (
  render: (nonce: string) => string,
): Response => {
  const nonce = signingPageNonce();
  return new Response(render(nonce), {
    status: 200,
    headers: {
      'Content-Security-Policy': signingPageCsp(nonce),
      'content-type': 'text/html; charset=utf-8',
    },
  });
};
