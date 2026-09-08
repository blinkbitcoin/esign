---
name: docusign-live-e2e
description: Use when running or debugging the live DocuSign verification (make docusign-check, make test-live, make e2e-live, the Playwright webform-live spec) - what each step proves, the failure modes seen on 2026-09-09 and their fixes, and what the walker expects from the capability test form.
---

# Live DocuSign E2E: running and debugging

Everything lives behind three targets (`scripts/e2e/live.sh`,
`examples/full-service-demo/scripts/docusign-check.ts`, docs in
`docs/integration/webforms.md`):

```sh
make docusign-check   # JWT grant + GET the form (?state=active) → name, state, field ids
make e2e-live         # check → Web Forms live API test → service on :4010 (DocuSign provider)
                      #   → Playwright walks the real form, asserts the locked fields → stop
```

Prerequisites: `examples/full-service-demo/.env` from `make docusign-env`
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
text if needed. Number fields carry at most two decimals (`settlement_amount_btc`
is minted as `0.01`). Instance tokens expire ~5 min after minting: never
reuse a URL across runs.

The live service log is `$RUNNER_TEMP/esign-live.log` (or `/tmp`); the
Playwright screenshot is `examples/react-demo/test-results/webform-live.png`
and the failure snapshot `test-results/webform-live-*/error-context.md`
shows the page as the walker saw it.
