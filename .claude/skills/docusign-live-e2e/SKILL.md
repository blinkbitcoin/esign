---
name: docusign-live-e2e
description: Use when running or debugging the live DocuSign verification (make docusign-check, make test-live, make e2e-live, the Playwright webform-live spec) - what each step proves, the failure modes seen on 2026-09-09 and their fixes, and what the walker expects from the capability test form.
---

# Live DocuSign E2E: running and debugging

Everything lives behind three targets (`scripts/e2e/live.sh`,
`examples/full-service-demo/scripts/docusign-check.ts`, docs in
`docs/integration/webforms.md`):

```sh
make docusign-check    # JWT grant + GET the form (?state=active) → name, state, field ids
make docusign-template # proxy-flow template from the fixture PDF (role signer), WRITE=1 → .env
make test-live         # both live API suites: envelopes (needs that template) + Web Forms
make e2e-live          # check → Web Forms live API test → E2E Postgres → service on :4010
                       #   → Playwright: raw form walk + tamper; the form inside the web
                       #   component (webform mode); a REAL SIGNATURE in proxy mode (ceremony
                       #   in the iframe → bridge → success screen)
                       #   → mint-only + serverless examples mint real instances → stop
```

In CI the same runner reads the DocuSign values from the environment
(job `E2E / Live DocuSign`, opt-in; `docs/operations/live-e2e-ci.md`).

Prerequisites locally: `examples/full-service-demo/.env` from `make docusign-env`
(see the docusign-integration-key-setup skill), consent granted with the
Web Forms scopes, the packages built (`npm run build`) for Playwright.

## What passes, and what each failure meant

| Symptom | Cause | Fix |
|---|---|---|
| `consent_required` on the grant | consent never granted for this key | open the URL `docusign-check` prints |
| 401 `AUTHORIZATION_INSUFFICIENT_SCOPE` on Web Forms | consent/grant without `webforms_*` scopes | re-consent with the full `DOCUSIGN_SCOPES` list |
| 400 `REQUIRED_QUERY_PARAMETER_MISSING 'state'` on GET form | the form GET needs `?state=active` | done in the check script |
| `REQUIRED_TAB_INCOMPLETE` in `envelope.live.test.ts` | the configured template is not built for the proxy flow (required tabs) | `e2e-live` runs only `webforms.live.test.ts`; `make test-live` runs both |
| 401 `Unauthorized` minting through the service | `JWT_SECRET` set, so the bearer is verified as a JWT; the spec sends the dev passthrough token | no `JWT_SECRET` in the live `.env` (docusign-env omits it) |
| service `EADDRINUSE` on :4010, spec hits stale settings | an earlier run's `tsx` child outlived the `npm` wrapper | the runner refuses a taken port and kills the real listener on exit |
| walker stuck on page A, later "prefill X should be displayed" | required editable fields empty (Signer_name, Signer_email, country) - the form refuses Next | prefill every required editable field (runner defaults do) |
| `toBeVisible` on inputs times out at 80% | the Summary page has no inputs | walker stops on a page without inputs |
| date prefill "should be displayed" | minted `2026-09-10`, rendered `2026/09/10` | dates compare on digits |

## Proxy-mode ceremony, headless

DocuSign's embedded ceremony drives fine in headless Chromium: disclosure
checkbox (`click({ force: true })`, a plain `check` fails) + Continue, the
tab is `button "Required - Sign Here"`, then `Adopt and Sign` (Full Name is
prefilled), then the first `Finish`. Both the disclosure and the adoption
are skipped by DocuSign for a recipient who did them on an earlier
envelope (same name/email/clientUserId), so the spec treats both as
optional. After Finish the frame navigates to DOCUSIGN_RETURN_URL; from a
public site to localhost Chrome answers
ERR_BLOCKED_BY_LOCAL_NETWORK_ACCESS_CHECKS unless Chromium runs with
`--disable-features=LocalNetworkAccessChecks` (the live configs do). Two
`Finish` buttons exist - use `.first()`. The envelope must be persisted, so
the runner brings up the E2E Postgres and exports its DATABASE_URL before
migrating (dotenv-cli never overrides an existing variable).

## Read-only Number and Date fields break the submission (demo env)

`Summary → Next` on a form with a read-only NUMBER or DATE field answers
422 `UNPROCESSABLE_ERROR`; read-only Text/Dropdown fields submit fine
(200 + envelope, values on the document). Bisected 2026-09-09 on builder
copies and on v2 itself (field types are frozen once a form is active, so
retyping means copying the form; the Read only toggle can still be
changed on an active form: Edit Form → toggle → Activate → "Activate and
Replace"). The live fixture is therefore v2
(`c640d957-a2d0-4e36-9975-5374afb02b54`), whose four amounts are Text
fields prefilled as strings and whose Date field is editable; the
in-iframe spec submits it, signs the resulting envelope and completes
through the bridge. Diagnosis tools if it
regresses: scratch Playwright scripts that `page.route()` the
`/actions/ESignAction_…` POST to rewrite the multipart `formValues` and
read the response; the spec logs the `x-docusign-tracetoken` /
`x-request-id` of the submission. See docs/integration/webforms.md
"Submitting a form with read-only fields". DocuSign's API request logging
does not capture the submission (it is not made with the user's
credentials).

## The React Native run (`make e2e-ios-live`)

`scripts/e2e/ios-live.sh` shares the service bootstrap with `live.sh`
(`live-service.sh`), starts Metro with `ESIGN_MODE=webform
ESIGN_BACKEND_PORT=<LIVE_PORT> ESIGN_PREFILL=<fixture prefill>` (inlined
by Babel - a Metro already on :8081 would serve a bundle without them, so
the runner refuses to start next to one) and runs
`.maestro/webform-live.yaml` on the booted simulator with the app
installed. Inside the WebView the Web Form is accessible by text but its
buttons sit below the fold (`scrollUntilVisible` before every tap); the
signing ceremony exposes no text at all, so Sign (28%,78%) and Finish
(50%,88%) are position taps for the iPhone 16 Pro. The ceremony requests
geolocation: iOS shows the prompt when the app holds location access - the
flow taps "Don’t Allow" (optional). Verified 2026-09-09: envelope created,
signed, `onComplete` alert with the envelope id.

## What the walker expects from the fixture form

Start → pages A (signer, required), B (prefilled editable), C (locked
terms), D (optional) → Summary. Fields are collected per page from
`input, select, textarea` with labels from `<label for>` / aria. Locked
text fields render `readOnly` or `disabled`; a locked dropdown keeps the
select enabled and disables every option. After the walk the spec reopens
section C from the Summary (its Edit button) and tampers with every locked
field (click, type, `fill` and `selectOption` with `force`), asserting the
value is unchanged. Controls are found with `getByRole('textbox'|'combobox', { name })`,
not `getByLabel` - DocuSign names them through aria. Radio/checkbox values are the option
values (`yes`/`no`), never checked state, so assert them via the Summary
text if needed. Locked amounts are Text fields minted as strings
(`settlement_amount_btc` is `"0.01268231"`); Number and Date fields must
never be read-only (a Number field also carries at most two decimals). Instance tokens expire ~5 min
after minting: never reuse a URL across runs.

The live service log is `$RUNNER_TEMP/esign-live.log` (or `/tmp`); the
Playwright screenshot is `examples/react-demo/test-results/webform-live.png`
and the failure snapshot `test-results/webform-live-*/error-context.md`
shows the page as the walker saw it.
