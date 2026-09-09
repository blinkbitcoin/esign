# The invest flow: locked terms, end to end (the Blink recipe)

Everything an engineer needs to ship "the customer signs an agreement whose
terms we set and they cannot change" into an existing GraphQL API and a
React Native app. Mode 2 of the README (Web Forms instances). Every step
below is what `examples/mint-only-demo` (the API side) and
`examples/react-native-demo` in webform mode (the app side) do, and what
`make e2e-live` / `make e2e-ios-live` verify against real DocuSign.

Read first, once: [docusign-lessons.md](docusign-lessons.md) (the rules
that are not obvious, one page).

## The shape

```
app                    your API                          DocuSign
 |  mutation (session)  |                                   |
 |--------------------->|  createWebFormInstance(prefill)   |
 |                      |---------------------------------->|
 |   { url }            |          { formUrl, token }       |
 |<---------------------|<----------------------------------|
 |  WebView opens url ------------------------------------->|  form, locked terms, submit,
 |                                                          |  envelope, signing ceremony
 |                      |  GET /signing/return?event=...    |
 |                      |<----------------------------------|  (the WebView is redirected)
 |  postMessage from the bridge page                        |
 |<---------------------|                                   |
 |  onComplete({ envelopeId })                              |
```

Three parts: the DocuSign account and form (once), one mutation plus one
route in the API, one source in the app.

## 1. DocuSign account and form (once, by whoever owns the account)

1. Integration key with a JWT grant, consent including the Web Forms
   scopes, RSA keypair with the public half uploaded:
   [docusign-proxy.md](docusign-proxy.md) section 1, or the
   `docusign-integration-key-setup` skill. Never handle the private key
   outside the server's secret store.
2. A Web Form in the builder, mapped to the agreement's template. Rules
   (verified, [webforms.md](webforms.md) "The capability test form" has a
   full example):
   - Every locked value is a **Text** field (a Dropdown for a choice) with
     **Read only** and **Required** on. **Never a Number or Date field**:
     DocuSign refuses the submission (422) when one is read-only.
   - The two recipient fields the builder adds (`Signer_name`,
     `Signer_email`) are mapped under Signature → Recipient Connections
     and must be prefilled (or editable) - they feed the envelope's signer.
   - Access setting **Private** (the app opens API-minted instance URLs;
     Public only adds a CAPTCHA-protected public link).
   - Signature settings: "Initiate signing session from email" off
     (embedded signing), "Enable document field editing" off.
   - Nothing locked is hidden by a rule (hidden fields never reach the
     document). Field types freeze on activation: to retype, copy the form.
3. Note the form id and each field's **API reference name** (the prefill
   keys) from the builder, or from `GET …/forms/{formId}`.

## 2. The API side (Node, any GraphQL server)

Install `@blinkbitcoin/esign-server` (Node only; registry setup in
[consuming.md](consuming.md)). Environment (server secrets):

| Variable | Value |
|---|---|
| `DOCUSIGN_INTEGRATION_KEY`, `DOCUSIGN_USER_ID`, `DOCUSIGN_ACCOUNT_ID`, `DOCUSIGN_PRIVATE_KEY` | the JWT grant (step 1) |
| `DOCUSIGN_WEBFORM_ID` | the form (step 1) |
| `DOCUSIGN_RETURN_URL` | `https://<your api>/signing/return` - the bridge route below |
| `DOCUSIGN_BASE_URL`, `DOCUSIGN_OAUTH_URL`, `DOCUSIGN_WEBFORMS_BASE_URL` | defaults are the demo environment; set the production hosts in production |

**One mutation.** Authenticate the caller with the API's own session
(the package never sees the token), compute the terms from the API's own
data, format them as the strings the signer must see, mint:

```ts
import { createWebFormInstance, docuSignConfigFromEnv, assertDocuSignConfig } from '@blinkbitcoin/esign-server';

const docusign = docuSignConfigFromEnv();  // once, at startup
assertDocuSignConfig(docusign);            // fails fast on a missing variable

// resolver of e.g. investSigningUrl(units: Int!): { url, instanceId }
const { url, instanceId } = await createWebFormInstance({
  config: docusign,
  userId: session.userId,        // becomes DocuSign's clientUserId: a stable id per signer, <= 100 chars
  prefill: {
    Signer_name: session.name,   // the recipient fields, if the form does not let the signer type them
    Signer_email: session.email,
    number_of_units: String(quote.units),                          // locked Text fields take strings
    total_subscription_usd: quote.totalUsd.toFixed(2),
    settlement_amount_btc: quote.btc.toFixed(8),                   // no two-decimal limit on Text
    btc_usd_rate: quote.rate.toFixed(2),
    rate_timestamp: quote.quotedAt.toISOString(),
    settlement_date: '2026-09-10',                                 // a locked date is text too
  },
  // returnUrl: defaults to DOCUSIGN_RETURN_URL
});
```

Return `{ url, instanceId }` to the app. The url carries an instance token
that expires about **five minutes** after minting, so mint when the user
opens the screen, not before. Numbers for *editable* Number fields stay JSON
numbers; the full value contract is in [webforms.md](webforms.md).

**One route: the return-URL bridge.** After the customer signs, DocuSign
redirects the WebView to `returnUrl` with an `event` query parameter. The
bridge page turns that into the postMessage the component understands.
Serve it at the path `DOCUSIGN_RETURN_URL` points to:

```ts
import { renderSigningReturnBridge } from '@blinkbitcoin/esign-server';
import { randomUUID } from 'node:crypto';

app.get('/signing/return', (req, res) => {
  const event = typeof req.query.event === 'string' ? req.query.event : undefined;
  const nonce = randomUUID();
  res.setHeader('content-security-policy', `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'`);
  res.type('html').send(renderSigningReturnBridge(event, nonce));
});
```

(Express hosts can mount `createESignRouter` from
`@blinkbitcoin/esign-server/express` instead, which serves the same route.)
Without this route the form completes on DocuSign's side and the app never
hears about it. The whole API side, runnable: `examples/mint-only-demo`
(`make e2e-server-demos` on the mock provider, `make e2e-live` on DocuSign).

## 3. The app side (React Native; web is the same with `@blinkbitcoin/esign-react`)

Install the package and its two WebView peers only - no Apollo, no GraphQL
needed by the library:

```sh
npm i @blinkbitcoin/esign-react-native react-native-webview @react-native-community/netinfo
```

Mint through the API's own client (the mutation above), then hand the
component a source whose `createInstance` is that call:

```tsx
import { ESignature, createWebFormsSource } from '@blinkbitcoin/esign-react-native/webform';

const source = createWebFormsSource({
  createInstance: async () => {
    const { data } = await apollo.mutate({ mutation: INVEST_SIGNING_URL, variables: { units } });
    return { url: data.investSigningUrl.url, envelopeId: data.investSigningUrl.instanceId };
  },
  // Do NOT set allowedOrigin to DocuSign's domain here: on web the
  // completion message comes from the bridge page, i.e. your API's origin.
  // allowedOrigin: 'https://api.example.com'  (web; React Native ignores it)
});

<ESignature
  source={source}
  onComplete={({ envelopeId }) => { /* signed: the envelope DocuSign created from the form */ }}
  onError={({ code, message }) => { /* ENVELOPE_CREATION_FAILED = the mint failed, see error-codes.md */ }}
  onCancel={() => {}}
/>
```

(If the API exposes a plain `POST` endpoint returning `{ url }` instead of
a mutation, `mint: { url, getAuthToken }` does the request for you;
`getAuthToken` returns the app's own session token for that endpoint.)

What the app can expect:

- The real form renders in the WebView; the locked terms are shown and
  cannot be edited; the customer fills the editable fields, submits, signs
  the envelope in DocuSign's ceremony in the same WebView, taps Finish.
- The ceremony asks for the device's **location**. On iOS the system prompt
  appears when the app holds location access; declining does not affect
  signing. Expect it in the UX, or keep geolocation off in the WebView.
- Completion arrives as `onComplete({ envelopeId })` through the bridge
  page. Nothing else has to be installed; DocuSign.js is not involved.
- Web: the same source from `@blinkbitcoin/esign-react` renders an iframe
  (DocuSign allows framing instance URLs).

## 4. Verify before shipping

- Locally against the demo account: `make e2e-live` (browser: locked
  fields, tamper checks, submission, signature, bridge) and
  `make e2e-ios-live` (the same journey in the React Native demo's WebView).
- Then the same against the **production** account with the production
  form and hosts: the findings so far are from the demo environment
  ([docusign-lessons.md](docusign-lessons.md), "Still open").
- Operations: the opt-in CI job in
  [operations/live-e2e-ci.md](../operations/live-e2e-ci.md).

## What is not needed

- No new service, no database, no webhooks for this flow: the envelope
  status lives in DocuSign; `onComplete` is the app's signal. (Webhooks and
  envelope persistence are mode 3, [docusign-proxy.md](docusign-proxy.md).)
- No `JWT_SECRET`: that belongs to this repo's full service. Your API
  verifies its own session however it already does.
