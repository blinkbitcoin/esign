# DocuSign Web Forms Mode

**Updated:** 2026-07-06

The signing component supports three modes via its `SigningSource` (see the
package READMEs). This doc covers the **DocuSign Web Forms** mode: a prefilled,
form-based signing experience, minted by the backend and embedded in the client.

Two ways to run it:

- **Deterministic (CI):** `ESIGN_PROVIDER=mock` → the backend mints a local
  **mock web-form** instance (`/signing/mock-webform/:id`) that emits the *real*
  DocuSign event vocabulary. No credentials. This is what the E2E suites run.
- **Live:** `ESIGN_PROVIDER=docusign` + the DocuSign config below → the backend
  calls the real Web Forms `Instances:createInstance` API. Credentialed;
  not for public CI.

## How it flows

```
demo (webform mode)  ──POST /webform/instance──▶  backend
                                                  provider.createWebFormInstance(prefill)
                                                    mock     → mock-webform URL
                                                    docusign → real instance URL
        ◀──────────── { url } ─────────────────
  createWebFormsSource embeds url in WebView/iframe
        ◀─ postMessage: { type: 'signingComplete' | 'signingCancel' | ... }
  interpretDocuSignEvent → onComplete / onCancel / ...
```

The backend endpoint is provider-agnostic (`POST /webform/instance`,
authenticated); the mode is chosen by `ESIGN_PROVIDER`. Nothing DocuSign-specific
lives outside the DocuSign adapter (`apps/api/src/providers/docusign/`).

## Toggling the demos

| | Flag | Example |
|---|---|---|
| Web demo (Vite) | `VITE_ESIGN_MODE` | `VITE_ESIGN_MODE=webform npm run dev` |
| RN demo (Metro, bundle-time) | `ESIGN_MODE` | `ESIGN_MODE=webform npm start` |

Both default to `proxy`.

## Running the E2E

```sh
# Web (deterministic, real cross-origin iframe, mock web-form page):
make e2e-web-webform

# Mobile (deterministic, real WebView):
#   backend + ESIGN_MODE=webform Metro + simulator, then:
#   maestro test examples/react-native-demo/.maestro/webform-happy-path.yaml \
#     -e APP_ID=org.reactjs.native.example.ReactNativeSandbox
```

Both exercise `createWebFormsSource` + `interpretDocuSignEvent` against a page
emitting the real DocuSign event names — so a green run proves the actual
protocol, not a lenient stand-in.

## Live run against real DocuSign

1. Complete the DocuSign account + JWT setup in
   [docusign-setup.md](docusign-setup.md) (consent, keys, account/user IDs).
2. Build and **publish a Web Form** in the DocuSign Web Forms builder, mapped to
   a template; note its **form id** and the fields' **API reference names**
   (these are the `formValues`/prefill keys).
3. Configure the backend (`apps/api/.env`):
   ```env
   ESIGN_PROVIDER=docusign
   DOCUSIGN_WEBFORM_ID=<form id>
   DOCUSIGN_WEBFORMS_BASE_URL=https://apps-d.docusign.com/api/webforms/v1.1
   # + the standard DOCUSIGN_* JWT config (see docusign-setup.md)
   ```
4. Verify the API contract without a UI: `make test-live` in `apps/api` runs
   `tests/live/webforms.live.test.ts` — real JWT auth + a real
   `createInstance` call, asserting the response shape and that the minted
   URL is served. Skips itself when the `DOCUSIGN_*` env vars are unset, so
   it is safe to leave in place (it is excluded from `npm test` and CI).
5. Run a demo in webform mode; it now embeds the real form.

## Verified against DocuSign docs (2026-07)

- **createInstance** — endpoint `…/webforms/v1.1/accounts/{id}/forms/{formId}/instances`,
  body `{ clientUserId (REQUIRED, ≤100 chars), formValues }`, response
  `{ formUrl, instanceToken }` (token ~5 min TTL). Implemented in
  `providers/docusign/client.ts`. ✓
- **Event model** — real DocuSign delivers a single **`sessionEnd`** event via
  DocuSign.js, with the outcome in a discriminator: `signingResult` /
  `formConfirmation` (done), `sessionTimeout` (timeout). `interpretDocuSignEvent`
  and the mock-webform page now use this real vocabulary. ✓

## Two web embedding options

Real DocuSign Web Forms are embedded via **DocuSign.js** (`bundle.js`), which
creates the iframe and dispatches `sessionEnd`. A plain `<iframe src>` does
**not** receive those events. So the web package offers two sources:

| Source | Embedding | Use for |
|--------|-----------|---------|
| `createWebFormsSource` | plain iframe + postMessage | the deterministic **mock** flow (our mock page posts the events); simple hosts |
| `createDocuSignWebFormsSource` | **DocuSign.js SDK mount** | **real** DocuSign Web Forms (loads `bundle.js`, needs an `integrationKey`) |

```tsx
// Real web Web Forms:
const source = createDocuSignWebFormsSource({
  createInstance: () => fetch('/webform/instance', { method: 'POST', ... }).then(r => r.json()),
  integrationKey: 'your-integration-key',
  environment: 'demo', // or 'production'
});
<ESignature source={source} onComplete onError onCancel />
```

## Remaining live-verification items

Actionable one-pass checklist (capture points + where to fix mismatches):
[docusign-setup.md, section 5](docusign-setup.md).

- **The exact DocuSign.js SDK surface** — `createDocuSignWebFormsSource` is
  written to the documented API (`loadDocuSign` → `signing({url})` → `.on('sessionEnd')`
  → `.mount()`) and its wiring is unit-tested with a fake SDK, but the precise
  method signatures are marked to confirm against a live account (the loader is
  `istanbul ignore`d). The `sessionEnd` discriminator **field name** (`type` vs
  `sessionEndType` vs `returnValue`) is handled defensively - the interpreter
  scans all three.
- **Mobile.** DocuSign.js has no React Native equivalent, so **real Web Forms is
  web-only**; the RN Web Forms path works against the mock but has no real-DocuSign
  embedding. Reinforces the "Web Forms is web-first" conclusion.
- **Entitlement.** Web Forms may require a specific account plan/feature even in
  the demo environment.
