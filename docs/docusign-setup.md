# Testing with Real DocuSign

**Updated:** 2026-07-03

How to run against a real DocuSign (demo/sandbox) account instead of the mock
provider. Sections 1-4 cover the **proxy envelope mode** (JWT auth, templates,
return-URL bridge, Connect webhooks); section 5 is the live smoke-test
checklist for **all** modes. For the **Web Forms** and **public URL** modes see
[webforms-setup.md](webforms-setup.md) - section 1 here (account + JWT setup)
is shared by both docs. See
[architecture-backend.md](architecture-backend.md) for how the provider
adapter works internally.

## 1. DocuSign Developer Account (~15 min, free)

1. Create a **developer (demo) account** at
   [developers.docusign.com](https://developers.docusign.com). The backend's
   defaults already target the demo environment
   (`https://demo.docusign.net/restapi`, `https://account-d.docusign.com`).
2. **Admin → Apps and Keys → Add App / Integration Key**. On the app:
   - Generate an **RSA keypair**; download the private key PEM (shown once).
   - Add any **redirect URI** (e.g. `http://localhost:4000`) - needed for the
     consent step below, not used at runtime.
3. **Grant one-time consent** for JWT impersonation (without it the token
   request fails with `consent_required`). Open in a browser, log in, accept:

   ```
   https://account-d.docusign.com/oauth/auth?response_type=code&scope=signature%20impersonation&client_id=<INTEGRATION_KEY>&redirect_uri=<REDIRECT_URI>
   ```

   The scope `signature impersonation` matches exactly what
   `apps/api/src/providers/docusign/` requests in its JWT assertion.
4. From the Apps and Keys page, note the **API Account ID** and your
   **User ID** (both GUIDs).
5. **Create a template**: upload any PDF, add a recipient **role named
   exactly `signer`** - this must match `roleName: 'signer'` in
   `providers/docusign/` - place a Sign Here tab, save, and copy the **template ID**.

## 2. Backend Configuration (`apps/api/.env`)

```env
ESIGN_PROVIDER=docusign
DOCUSIGN_ACCOUNT_ID=<api-account-guid>
DOCUSIGN_INTEGRATION_KEY=<integration-key-guid>
DOCUSIGN_USER_ID=<user-guid>
DOCUSIGN_TEMPLATE_ID=<template-guid>
DOCUSIGN_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----
...paste the PEM lines verbatim...
-----END RSA PRIVATE KEY-----"
```

- `dotenv` handles the multiline PEM **when double-quoted**. direnv's `.env`
  parser may not - the in-code dotenv fallback covers that case, so the
  server works either way.
- Config is **fail-fast**: `make backend` refuses to start and names every
  missing variable. With `ESIGN_PROVIDER=docusign`, `DOCUSIGN_HMAC_KEY` is
  also required at boot (webhook signature verification) unless
  `ALLOW_INSECURE_DEV=true` - see [security.md](security.md).

Then run as usual: `make db-up migrate backend` plus `make ios` /
`make android` (RN demo) or `make dev` in `examples/react-demo` (web).

## 3. The Return-URL Bridge (implemented)

The client components listen for **postMessage events**
(`signing_complete`, `cancel`, `decline`, `session_timeout`, `exception`).
**Real DocuSign embedded signing does not postMessage** - it redirects the
embedded page to `DOCUSIGN_RETURN_URL` with an `event` query parameter.

The backend bridges this: `GET /signing/return` (the `DOCUSIGN_RETURN_URL`
default) serves a page that maps DocuSign's redirect events onto the client
protocol (`ttl_expired` → `session_timeout`; unknown values → `exception`,
query input is never interpolated raw) and forwards them via
`window.ReactNativeWebView.postMessage` (RN WebView) or
`window.parent.postMessage` (web iframe). Implementation:
`apps/api/src/signingPages.ts`; behavior covered by
`tests/signingPages.test.ts`.

If you override `DOCUSIGN_RETURN_URL`, point it at a publicly reachable
deployment of this same route.

## 4. Optional: Webhooks (DB status sync)

The UI flow completes without webhooks, but the envelope row stays `sent`
unless DocuSign Connect can reach the backend:

1. Tunnel: `ngrok http 4000` (or `cloudflared tunnel --url http://localhost:4000`)
2. DocuSign **Admin → Connect → Add Configuration**:
   - URL: `https://<tunnel-host>/webhook/esign`
   - **HMAC key**: must match `DOCUSIGN_HMAC_KEY` in `apps/api/.env`
     (unset = dev mode accepts unsigned webhooks with a warning)
   - Events: envelope completed / declined / voided

## 5. Live smoke-test checklist (first real run)

All test suites are hermetic: they prove our half of every DocuSign contract
against payload shapes taken from DocuSign's docs, never against a live
account. Whoever first runs against a real demo account should confirm those
shapes in one pass. Capture each payload, tick or correct, then record the
date in the "Verified against DocuSign docs" section of
[webforms-setup.md](webforms-setup.md).

Prereq: sections 1–2 done, and the mock E2E suites green first (`make
check-code`, `make e2e`) so any failure here is a shape mismatch, not a
regression.

| # | Assumption to confirm | How to capture | Where to fix if wrong |
|---|----------------------|----------------|----------------------|
| 1 | Envelope creation + recipient view succeed (template role `signer`, `clientUserId` = email, status `sent`) | **Automated**: `make test-live` in `apps/api` (skips unless `DOCUSIGN_*` + `DOCUSIGN_TEMPLATE_ID` are set; logs the signing ceremony URL to hand off to item 2) | `providers/docusign/client.ts` |
| 2 | Return-URL redirect carries `?event=` with values `signing_complete` / `cancel` / `decline` / `session_timeout` / `ttl_expired` | ngrok inspector (`http://127.0.0.1:4040`) or backend request log — the GET hitting the bridge route after each outcome (finish, cancel, decline, let the session expire) | `mapDocuSignReturnEvent` in `apps/api/src/signingPages.ts` (unknown values already fail safe to `exception`) |
| 3 | Connect webhook: HMAC header is `x-docusign-signature-1`, body has `event: "envelope-completed"` etc. and `data.envelopeId` | ngrok inspector shows the raw POST to `/webhook/esign` — headers + body, no code changes needed | `parseWebhookEvent` in `providers/docusign/index.ts` + the payload type in `providers/docusign/mapping.ts`; mirror any change in `tests/webhook*.test.ts` fixtures |
| 4 | Web Forms `createInstance` request/response (`clientUserId` + `formValues` in, `formUrl` + `instanceToken` out) + JWT auth | **Automated**: `make test-live` in `apps/api` (skips unless `DOCUSIGN_*` env is set; on contract mismatch it fails with DocuSign's raw HTTP body, and it logs a minted instance URL to hand off to items 5-6) | `createWebFormInstanceRequest` in `providers/docusign/client.ts` |
| 5 | DocuSign.js `sessionEnd` event: discriminator field (`type` / `sessionEndType` / `returnValue`) and values (`signingResult`, `formConfirmation`, `sessionTimeout`) | Web demo + browser devtools: log the raw event in the `sessionEnd` handler (temp `console.log` in `packages/esign-react/src/docusignWebForms.ts`), exercise finish + timeout | `interpretDocuSignEvent` in `packages/esign-core/src/signing/events.ts` + the mock page vocabulary in `apps/api/src/signingPages.ts` |
| 6 | RN WebView + real Web Forms: does a plain WebView receive any events at all? (Assumed **no** — DocuSign.js is web-only) | RN demo in webform mode against the real backend; watch Metro logs for `onMessage` traffic while completing a form | If events do arrive: update the caveat in [consuming.md](consuming.md). If not (expected): the return-URL bridge stays the documented RN path |

Items 2 and 3 need the tunnel from section 4. Items 4–6 need a published Web
Form ([webforms-setup.md](webforms-setup.md)) and may require Web Forms
entitlement on the demo account.

## Gotchas

| Symptom | Cause |
|---------|-------|
| `consent_required` on first request | Step 1.3 consent grant not done |
| Envelope creation 400 | Template role name isn't exactly `signer`, or template has no Sign Here tab |
| Blank iframe on web | Frame blocking - check the browser console; the RN WebView is unaffected. Set `allowedOrigin` to the signing domain |
| Component stuck in `signing` after a real signature | `DOCUSIGN_RETURN_URL` overridden to a URL that isn't the bridge route (section 3) |
| "DEMONSTRATION" watermark on documents | Expected on demo accounts |
| Restart (`getSigningUrl`) returns not-found | `clientUserId` is the recipient email - the restart must use the same email |
