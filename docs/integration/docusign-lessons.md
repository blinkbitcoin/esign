# DocuSign Web Forms with locked terms: what we learned

The single-page summary of everything the live runs against a real DocuSign
account taught us (demo environment, 2026-09-08 to 2026-09-09). Each point
links to the place with the evidence and the mechanics. Read this before
designing a form or a flow that must lock values the signer cannot change.

## The conclusion in three lines

1. A Web Form can lock values, and the whole journey works end to end -
   mint an instance server-side with the values, the form shows them
   read-only, the signer submits, signs the envelope, and the component
   reports completion. Proven by `make e2e-live`.
2. The one rule that makes or breaks it: **read-only fields must be Text or
   Dropdown fields. A read-only Number or Date field makes DocuSign refuse
   the submission** (422, no reason given). Format amounts and dates
   server-side as strings and prefill them into Text fields.
3. Locking values needs one server-side call (`createInstance`) made with
   the integration key. There is no backend-free way to lock a value.

## Locking values

| Lesson | Detail | Where |
|---|---|---|
| Only `createInstance` populates read-only fields | Prefill by URL (`#field=value`) and by DocuSign.js is ignored for read-only fields: they render locked but empty, and the submit fails because they are required. Documented DocuSign behaviour, reproduced. | [webforms.md](webforms.md), "How we got here" |
| Read-only is a builder setting, not an API flag | The app's only job is to supply the value; the builder decides which fields are locked. The Web Forms API cannot create or edit forms, and `getForm` does not expose the read-only flag. | [webforms.md](webforms.md) |
| Read-only Number or Date = 422 on submit | Bisected on builder copies and on the fixture itself: read-only Text and Dropdown submit (200, envelope, values on the document); read-only Number or Date answer 422 `UNPROCESSABLE_ERROR` "Request sent is well formed but otherwise invalid", whatever the values. | [webforms.md](webforms.md), "Submitting a form with read-only fields" |
| Number fields take at most two decimals | The API accepts `0.00380467` for a Number field and the form renders it, then flags the field invalid; if the field is read-only the signer is stranded. A BTC amount belongs in a Text field. | [webforms.md](webforms.md), fixture notes |
| Text fields keep the exact string | What the backend formats is what the signer sees and what the document carries: format money and dates server-side (`"0.01268231"`, `"2026-09-10"`). | `examples/mint-only-demo/src/quote.ts` |
| Hidden fields never reach the document | Hiding a locked field with a rule drops it from the submission. | [webforms.md](webforms.md), "How we got here" |
| Locked display is not locked completion | Every API-minted instance showed the locked values and refused edits long before the submission was fixed. A green "values are shown and locked" run says nothing about completing the form; only a submitted, signed envelope does. | `examples/react-demo/e2e/webform-live-demo.spec.ts` |

## Why a backend, and how small

| Lesson | Detail | Where |
|---|---|---|
| The mint must run server-side | `createInstance` needs the integration key's private key (JWT grant), and a locked value only means something when minted by a party the signer does not control. | [webforms.md](webforms.md), "Why a server call at all" |
| It is one call | `createWebFormInstance` from `@blinkbitcoin/esign-server` behind one authenticated endpoint; for the invest flow, a mutation in the Blink API where the quote already lives, not a new service. | `packages/esign-server/README.md`, `examples/mint-only-demo/` |
| Everything else stays backend-free | Form UI, validation, document, envelope creation and the signing ceremony are DocuSign's. | [webforms.md](webforms.md) |
| Public URL = editable only | The public form URL suits forms with nothing to lock. It also sits behind a CAPTCHA (no headless E2E) and anyone with the link can start a form. | [webforms.md](webforms.md), fixture notes |
| Keep the form Private | The app and the suites open only API-minted instance URLs (`formUrl#instanceToken=…`), which work either way; Public only adds the public URL. | [docusign-live-e2e skill](../../.claude/skills/docusign-live-e2e/SKILL.md) |

## Completion without DocuSign.js (React Native)

| Lesson | Detail | Where |
|---|---|---|
| `returnUrl` on the instance | DocuSign redirects the frame there after signing; the service's `/signing/return` bridge turns that into the postMessage protocol both components understand. A plain WebView or iframe gets a completion signal; DocuSign.js is not needed. | [docusign-proxy.md](docusign-proxy.md), "return-URL bridge" |
| Framing an instance works | DocuSign sends no `frame-ancestors`; the real form and the signing ceremony both run inside the component's iframe. | `examples/react-demo/e2e/webform-live-demo.spec.ts` |
| Instance tokens live ~5 minutes | Mint right before opening; never reuse a URL across runs. | [webforms.md](webforms.md) |
| Repeat recipients skip steps | The e-signature disclosure and "Adopt and Sign" appear only on a recipient's first envelope; automation must treat both as optional. | `examples/react-demo/e2e/liveCeremony.ts` |

## The DocuSign account side

| Lesson | Detail | Where |
|---|---|---|
| JWT consent needs the Web Forms scopes | `signature impersonation webforms_read webforms_instance_read webforms_instance_write`; a consent without them fails later with `AUTHORIZATION_INSUFFICIENT_SCOPE`. `consentUrl()` builds the right URL. | [docusign-proxy.md](docusign-proxy.md), [live-e2e-ci.md](../operations/live-e2e-ci.md) |
| Keypair stays local | Generate locally, upload the public half, never print or paste the PEM; `make docusign-env` inlines it into `.env`. | [docusign-integration-key-setup skill](../../.claude/skills/docusign-integration-key-setup/SKILL.md) |
| Activation needs "Connect Account" | The first activation of a form asks to connect an eSignature account (an OAuth consent) and pick a default sender; later edits of an active form are a draft activated with "Activate and Replace". | [docusign-live-e2e skill](../../.claude/skills/docusign-live-e2e/SKILL.md) |
| Field types freeze on activation | The Field Type selector disappears once a form is active; the Read only toggle can still be changed. To retype a field, copy the form (which is how the v2 fixture came to be). | [webforms.md](webforms.md), fixture notes |
| Demo differs from production on URL prefill | The demo environment populates read-only fields from the URL and shows a toast saying production will not. Never use the public URL as a production smoke test. | [webforms.md](webforms.md), fixture notes |
| The submission is invisible to API logging | The form player's submit is not made with the user's credentials, so DocuSign's API request logging does not capture it. The response headers `x-docusign-tracetoken` / `x-request-id` are what support can look up; the live spec logs them. | [webforms.md](webforms.md), trace table |

## The fixture and the suite

| Lesson | Detail | Where |
|---|---|---|
| One generic form covers the surface | "esign capability test form v2 (text amounts)" (`c640d957-a2d0-4e36-9975-5374afb02b54`): signer-entered, prefilled-editable, locked (Text, Dropdown), optional and a signable block. Rebuildable from the table. | [webforms.md](webforms.md), "The capability test form" |
| What `make e2e-live` proves | JWT grant, instance mints, every minted value shown and every locked field refusing input (tamper loop), the real form inside the component submitted and signed, a proxy-mode signature, the small examples minting live. | [webforms.md](webforms.md), "Live run against real DocuSign" |
| Expected failures must be loud | While the submission was refused the suite carried it as an expected failure that turns red when behaviour changes, and the runner printed the limitation. Green alone would have hidden the gap. | git history of `webform-live-demo.spec.ts` |
| Bisect on copies, one change at a time | Rewriting the submission in flight ruled out the values; only builder copies with one setting changed each isolated the field types. | [webforms.md](webforms.md), bisect table |

## Still open

- Production environment: every finding above is from the demo account.
  The production behaviour is assumed to match and is unverified until a
  production account runs `make e2e-live`.
- Whether DocuSign treats a locked Dropdown the same in production as in
  demo (it submits fine in demo).
- A React Native run against the real form (the web runs are green; the
  RN suite still uses the mock page).
