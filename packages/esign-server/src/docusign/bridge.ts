// The return-URL bridge for REAL DocuSign. DocuSign's embedded signing never
// postMessages: it redirects the embedded page to DOCUSIGN_RETURN_URL with an
// `event` query param. The bridge page translates that into the postMessage
// protocol the client components listen for (the mock pages speak it
// natively).

import { type ClientEvent, POST_SIGNING_EVENT_SCRIPT } from '../bridge/script';
import { jsonForScript } from '../html';

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

// The return-URL bridge page: DocuSign redirects here with ?event=...; the
// page forwards it as a postMessage so the client components see the same
// protocol the mock speaks natively.
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
