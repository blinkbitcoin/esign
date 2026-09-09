// The Express spelling of signingPage.ts: send a signing page under the
// package's nonce CSP. Shared by the router (express.ts) and the DocuSign
// pages it mounts (docusign/express.ts). Types only from express, so this
// module has no runtime dependency on the peer.

import type { Response } from 'express';
import { signingPageCsp, signingPageNonce } from './signingPage';

// The signing pages share one CSP + nonce recipe with the Fetch-native
// signingPageResponse (signingPage.ts)
export const sendSigningPage = (
  res: Response,
  render: (nonce: string) => string,
): void => {
  const nonce = signingPageNonce();
  res.setHeader('Content-Security-Policy', signingPageCsp(nonce));
  res.type('html').send(render(nonce));
};
