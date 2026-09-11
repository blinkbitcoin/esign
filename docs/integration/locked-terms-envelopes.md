# Locked terms on a template envelope: the recipe, API side

The envelope counterpart of [locked-terms.md](locked-terms.md): the signer
opens the agreement itself (mode 3, proxy envelopes), with the host's values
already on the document and locked where the signer must not change them,
instead of a Web Form that asks for them first. Nothing is configured at
DocuSign for the lock: it travels with the value.

Read first, once: [docusign-lessons.md](docusign-lessons.md) (the rules that
are not obvious, one page) and section 1 of
[docusign-proxy.md](docusign-proxy.md) (account, template, role).

## The shape

```
your backend                                DocuSign
 |  createEnvelope(userId, { contractType,     |
 |    recipient, prefill })                    |
 |-------------------------------------------->|  envelope from the template(s),
 |          { envelopeId, signingUrl }         |  the role's Text tabs written,
 |<--------------------------------------------|  locked ones refusing edits
 |  the app opens signingUrl (the ESignature   |
 |  component's proxy source, unchanged)       |
```

## 1. The template (once, by whoever owns the account)

- One recipient role; its name is `DOCUSIGN_SIGNER_ROLE` (default `signer`).
- A **Text** tab per value the host will write, its **label** the prefill
  key. Only Text tabs take a value: DocuSign matches a template-role value
  by tab type + label, and a label naming a Number, Date or List tab is
  ignored with a 200 and an empty, editable field. Format money and dates
  as the strings the signer must see (`"10.00"`, `"2026-09-10"`).
- Several documents: one template each, their ids comma-separated in
  `DOCUSIGN_TEMPLATE_ID`, the signer role under the same name and routing
  order in every one (DocuSign merges the signer by email, name and routing
  order; that is what makes one signing session across the documents). The
  same prefill goes to every document; a document ignores a label it has no
  tab for.
- `make docusign-template` creates the repo's fixture with the Text tabs
  `reference` and `notes` ([docusign-proxy.md](docusign-proxy.md) section 1).

## 2. The backend side

The service's own GraphQL mutation deliberately has no `prefill` input:
terms the signer cannot change are the host's to compute, never the
client's to send (the same reason the mint resolves them from `TERMS_URL`).
So the prefill enters where the host process calls the envelope service,
in-process:

```ts
import { createEnvelopeService, createDocuSignProvider, docuSignConfigFromEnv } from '@blinkbitcoin/esign-node';

const envelopes = createEnvelopeService({ provider, store }); // as in the README

// In the host's own resolver or route, with the authenticated user and the
// terms computed from the host's data:
const { envelopeId, signingUrl } = await envelopes.createEnvelope(session.userId, {
  contractType: 'subscription',
  recipient: { name: session.name, email: session.email },
  prefill: {
    reference: { value: quote.reference, locked: true },   // shown, refuses edits
    total_usd: { value: quote.totalUsd.toFixed(2), locked: true },
    notes: 'Anything to add?',                             // a bare value keeps the template's own lock setting
    memo: { value: '', locked: false },                    // an explicit unlock, on purpose
  },
});
```

The value contract (`EnvelopeTabPrefill`,
`packages/esign-node/src/providers/docusign/types.ts`): a key is a Text tab
label; a value is a string, or `{ value, locked? }`. It is checked before
any request (`parseEnvelopePrefill`,
`packages/esign-node/src/providers/docusign/prefill.ts`, the same rules as
the Web Forms prefill: field names, at most 200 entries, a reason naming
the field) and refused as `VALIDATION_ERROR`; a locked empty value is
refused too, since neither side could ever fill it. `locked` travels to
DocuSign only when set: a bare value never unlocks a tab the template
designer locked.

Calling the DocuSign adapter directly (`provider.createEnvelope(userId,
contractType, recipient, prefill)`) is the same contract one layer down;
the mock provider keeps what it was sent (`getEnvelopePrefill(envelopeId)`)
for the host's tests.

**esign-service deployments**: the packaged service forwards a prefill
through its tracing wrapper and envelope service, but nothing supplies one
yet - resolving it server-side from `TERMS_URL`, as the mint does, is a
follow-up. Until then, envelope prefill is for hosts that embed
`@blinkbitcoin/esign-node`.

## 3. Verify

- `make test-live` in `packages/esign-service` against the demo account
  with the fixture: the created envelope's recipient view shows `reference`
  filled and locked.
- A two-id `DOCUSIGN_TEMPLATE_ID`: one signing session, both documents.
- Then the same against the production account
  ([operations/production.md](../operations/production.md)).
