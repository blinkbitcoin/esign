# DocuSign Web Forms Mode

**Updated:** 2026-09-08

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

[![Web Forms Mode Flow](../diagrams/dist/webforms-flow.svg)](../diagrams/src/webforms-flow.mmd)

The embedded page reports back via postMessage
(`{ type: 'signingComplete' | 'signingCancel' | ... }`);
`interpretDocuSignEvent` maps those to `onComplete` / `onCancel` / ...

The backend endpoint is provider-agnostic (`POST /webform/instance`,
authenticated); the mode is chosen by `ESIGN_PROVIDER`. Nothing DocuSign-specific
lives outside the DocuSign adapter (`apps/api/src/providers/docusign/`).

## Toggling the demos

| | Flag | Example |
|---|---|---|
| Web demo (Vite) | `VITE_ESIGN_MODE` | `VITE_ESIGN_MODE=webform npm run dev` |
| RN demo (Metro, bundle-time) | `ESIGN_MODE` | `ESIGN_MODE=webform npm start` |

Both default to `proxy`.

## Locking prefilled values (read-only fields)

A form typically mixes values the signer enters (country of residence) with
terms the sender has already fixed (number of units, amounts, an FX rate and
its timestamp). The fixed terms must not be editable in the form, or the
signed document can disagree with what the backend settles.

DocuSign's rules (verified against the Web Forms docs, 2026-09):

- A field marked **Read only** in the Web Forms builder can only be populated
  by a builder **default value** or by the `formValues` of an
  **`Instances:createInstance`** request. Prefill by URL (`#field=value`) and
  prefill through Docusign JS **cannot** populate read-only fields.
- A required read-only field left empty makes the submission fail
  ("Request sent is well formed but otherwise invalid").
- A field hidden by a rule is dropped from the submission - its value never
  reaches the document.

So the recipe is: mark the fixed fields Read only (keep Required) in the
builder, and mint every instance through the backend with those values in the
prefill. That is what `POST /webform/instance` does:

```json
{ "prefill": { "number_of_units": 1000, "total_subscription_usd": 1000,
               "settlement_amount_btc": 0.01268231, "rate_timestamp": "2026-09-08 10:44" } }
```

Keys are the fields' API reference names; the value shape follows the field
type (`apps/api/src/types.ts`): text / email / date (`yyyy-mm-dd`) / dropdown /
radio → string, **Number → a JSON number** (unquoted, `.` decimal, no
thousands separators), checkbox group → string array, phone →
`{ countryCode?, nationalNumber }`. The endpoint validates that contract at the
edge (`apps/api/src/webFormPrefill.ts`) and answers 400 with a reason for
anything else, before the provider is called. Mint the instance right before
opening it: the instance token expires about five minutes after creation.

### How we got here (2026-09-08)

The invest flow's first test against a published form showed every computed
field editable. Two builder-side fixes were tried and both fail, for reasons
that are documented DocuSign behaviour, not bugs to work around:

| Tried | Result | Why |
|---|---|---|
| Mark the fields **Read only** in the builder, keep prefilling by URL | fields render disabled but **empty**; submit fails with "Request sent is well formed but otherwise invalid" | URL prefill cannot populate read-only fields, and the fields are required |
| **Hide** the fields with a rule | the values never reach the document | hidden fields are dropped from the submission |

Options considered:

1. Ship v1 with the fields editable - rejected: the signer could sign a
   document whose amounts, rate and timestamp differ from what the backend
   settles.
2. eSignature envelopes from a template with locked tabs - workable, but a
   different product surface (no form step, DocuSign.js not involved) and a
   second integration to maintain next to Web Forms.
3. **Web Forms `createInstance` with `formValues`** - chosen: it is the one
   documented way to populate read-only fields, the backend already exposed it
   (`POST /webform/instance`), and the host only has to build the prefill
   from the values it already computed.

Sources (DocuSign, read 2026-09-08):
[Prefill web form instance fields](https://developers.docusign.com/docs/web-forms-api/plan-integration/prefill-instance-fields/)
("If supplied in an Instances:createInstance request, prefill values can be
used to populate read-only fields. If supplied with Docusign JS, prefill values
cannot"),
[Populate Read-Only Fields on a Web Form](https://support.docusign.com/s/document-item?language=en_US&bundleId=gmi1660583110357&topicId=hty1709929728541.html)
("Their values must be set either through the API or by assigning a default
value"),
[Prefill a Web Form By URL](https://support.docusign.com/s/document-item?language=en_US&bundleId=gmi1660583110357&topicId=kup1721242003741.html),
[Web form instance URLs](https://developers.docusign.com/docs/web-forms-api/plan-integration/instance-urls/)
(instance token expires five minutes after generation).

The **mock web-form page** models both prefill channels so the guarantee is
testable without credentials: values minted with the instance render as
locked (`readonly`) inputs, values arriving in the URL (public-form style)
render editable. The browser E2E (`e2e/webform.spec.ts`, `e2e/publicurl.spec.ts`),
the Maestro webform flow and the backend E2E (`tests/e2e/webform.e2e.test.ts`)
assert exactly that.

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
protocol, not a lenient stand-in. The web suites pick their ports per git
worktree (`examples/react-demo/e2e/ports.ts`; `E2E_PORT_OFFSET=0` for the
canonical :4000 / :5174), so parallel sessions never collide.

## Live run against real DocuSign

1. Complete the DocuSign account + JWT setup in
   [docusign-proxy.md](docusign-proxy.md) (consent, keys, account/user IDs).
2. Build and **publish a Web Form** in the DocuSign Web Forms builder, mapped to
   a template; note its **form id** and the fields' **API reference names**
   (these are the `formValues`/prefill keys).
3. Configure the backend (`apps/api/.env`):
   ```env
   ESIGN_PROVIDER=docusign
   DOCUSIGN_WEBFORM_ID=<form id>
   DOCUSIGN_WEBFORMS_BASE_URL=https://apps-d.docusign.com/api/webforms/v1.1
   # + the standard DOCUSIGN_* JWT config (see docusign-proxy.md)
   ```
4. Verify the API contract without a UI: `make test-live` in `apps/api` runs
   `tests/live/webforms.live.test.ts` — real JWT auth + a real
   `createInstance` call, asserting the response shape and that the minted
   URL is served. Skips itself when the `DOCUSIGN_*` env vars are unset, so
   it is safe to leave in place (it is excluded from `npm test` and CI).
   Set `DOCUSIGN_LIVE_PREFILL='{"number_of_units": 1000, ...}'` to also mint
   a typed-prefill instance for the configured form.
5. Verify the locked fields in a real browser: `make e2e-web-webform-live`
   runs `examples/react-demo/e2e/webform-live.spec.ts` against the real form
   (Playwright, no mock, no web servers started). It skips itself unless one
   of the first two variables is set:

   | Variable | Meaning |
   |---|---|
   | `E2E_LIVE_WEBFORM_URL` | An already-minted instance URL (`formUrl#instanceToken=...`, valid ~5 min) - opened as is |
   | `E2E_LIVE_API_ORIGIN` | Otherwise: a running backend (`ESIGN_PROVIDER=docusign`) the spec mints through |
   | `E2E_LIVE_AUTH_TOKEN` | Bearer for `POST /webform/instance` (default `e2e-live`, the dev passthrough userId) |
   | `E2E_LIVE_PREFILL` | JSON object of field API reference name → value to mint with |
   | `E2E_LIVE_LOCKED_LABELS` | JSON object of form label → expected value for the read-only fields |

   ```sh
   E2E_LIVE_API_ORIGIN=http://localhost:4000 \
   E2E_LIVE_PREFILL='{"number_of_units":1000,"settlement_amount_btc":0.01268231}' \
   E2E_LIVE_LOCKED_LABELS='{"Number of Units":"1000","Settlement Amount (BTC)":"0.01268231"}' \
   make e2e-web-webform-live
   ```

   It asserts every scalar prefill value is displayed, every labelled field
   shows the minted value and is read-only or disabled, and saves
   `examples/react-demo/test-results/webform-live.png`.
6. Run a demo in webform mode; it now embeds the real form.

## Verified against DocuSign docs (2026-07, prefill rules 2026-09)

- **createInstance** — endpoint `…/webforms/v1.1/accounts/{id}/forms/{formId}/instances`,
  body `{ clientUserId (REQUIRED, ≤100 chars), formValues }`, response
  `{ formUrl, instanceToken }` (token ~5 min TTL). Implemented in
  `providers/docusign/client.ts`. ✓
- **Read-only fields** — populated only by a builder default or by
  `createInstance` `formValues`; prefill by URL / Docusign JS is ignored for
  them ("Prefill web form instance fields", "Populate Read-Only Fields on a
  Web Form"). Number fields take unquoted numbers, dates `yyyy-mm-dd`,
  checkbox groups string arrays, phone `{ countryCode, nationalNumber }`. ✓
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
[docusign-proxy.md, section 5](docusign-proxy.md).

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
