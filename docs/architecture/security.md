# Security Model — packages/esign-service

**Updated:** 2026-09-14

The service's security posture, as the code enforces it. Controls are checked
once at boot and then per request; the defaults are fail-closed.

The operational view of the same rules — what to set in production, why, and
how to verify it — is
[docs/operations/production.md](../operations/production.md); the variable
table is [`packages/esign-service/README.md`](../../packages/esign-service/README.md#environment).

## Boot-time enforcement (fail-closed)

`configErrors(env, { runtime })` (`src/config.ts`) is pure — environment in, a
list of problems out — and `validateConfig` throws one message listing all of
them plus the capabilities that were on. A container refuses to boot; a
Vercel/Cloudflare function fails at first import. It refuses:

- an unknown `ESIGN_PROVIDER`, or a provider missing what a mint needs (the
  Web Form and the return URL; under `ESIGN_MINT_MODE=envelope`, the
  template and the return URL)
- an `ESIGN_MINT_MODE` other than `webform` or `envelope`
- an `ESIGN_PREFILL_URL` that is not an absolute `http(s)` URL — one the
  service could not POST to at all
- `DATABASE_URL` on the Cloudflare runtime (no Postgres driver there)

That is the whole list, and the shape of it is the point: each entry is
something the service **knows** is broken. What a deployment does not
*verify* is not on it.

### What is reported instead

Whether an unverified session matters depends on what sits in front of the
service; whether a client-supplied prefill matters depends on whether the
template's fields carry the deal. Neither is visible from inside this
process, so neither is the service's to refuse. It prints them instead, once,
at boot, on every target:

```
  capabilities  mint
  mint mode     webform
  provider      mock - the mock provider is a demo provider
  session       not verified - the bearer token is the user id
  prefill       client-supplied (ESIGN_PREFILL_URL unset)
  webhook       n/a (mint only)
```

The Node target also fetches `ESIGN_SESSION_JWKS_URL` before it listens and
adds what it found — how many keys the set offers, or why it could not be
read. `ESIGN_PREFILL_URL` is deliberately not probed: it is an endpoint on
someone else's service expecting a POST, and an unexpected request on every
boot is a side effect the operator did not ask for. `check-prefill` verifies
that one on demand, with the real POST.

### `ESIGN_STRICT=true`

One opt-in turns every line the banner reports as unverified into a refusal
to start, each naming the variable that fixes it, and makes a failed preflight
probe a refusal to listen. It is the whole of the old fail-closed posture
behind a single variable that an operator sets deliberately, rather than five
that a deployment had to opt *out* of.

**Nothing here is gated on `NODE_ENV`** — every Node image sets it, so it says
nothing about the e-signature configuration. The image makes no posture claim
of its own either: it starts, reports, and leaves `ESIGN_STRICT` to the
operator.

## Authentication (`src/session.ts`)

One session source, chosen by the environment alone, verified with `jose`:

- `ESIGN_SESSION_JWKS_URL` — RS/ES tokens against a remote, cached key set. The
  algorithm allow-list is **asymmetric only** (`RS*`, `ES*`, `PS256`), so a
  JWKS deployment can never be talked into accepting an HS256 token signed
  with the public key (the classic RS→HS confusion attack).
- `ESIGN_SESSION_SECRET` — a shared secret, `HS256` only.
- neither — no verification: the bearer token *is* the user id. A real
  deployment when a gateway already authenticated the caller, and reported as
  `session not verified` at boot.

`exp` is a **required** claim (a token without an expiry would be valid
forever, and nothing here can revoke one); `ESIGN_SESSION_ISSUER` / `ESIGN_SESSION_AUDIENCE`
are enforced when set; the user id comes from `ESIGN_SESSION_USER_CLAIM` (default
`sub`). Anything wrong — missing, malformed, expired, wrong key, wrong
issuer/audience, absent claim — is simply unauthenticated (`null`), never an
error surfaced to the caller. With no source configured the service does not
run unauthenticated: it refuses to boot (above).

## Authorization

The envelope domain (`createEnvelopeService`,
`packages/esign-node/src/envelopes.ts`) requires a user for every operation
and scopes data access by owner (`getEnvelopeByIdForUser`). Not-found and
wrong-owner are indistinguishable (no existence oracle). `providerEnvelopeId`
is never returned to clients.

## Webhooks (`src/envelopes.ts` over the package's `createWebhookHandler`)

- HMAC-SHA256 over the **raw** body, timing-safe compare
  (`packages/esign-node/src/hmac.ts`); missing/invalid signature → 401. Fail
  closed unless the host explicitly allows unsigned webhooks
  (no `DOCUSIGN_HMAC_KEY` configured).
- **Terminal-state machine**: no transition out of `completed`/`voided`/
  `declined`. Blocks replay-downgrades (a captured, validly-signed older
  `sent` webhook can't reopen a finished envelope).
- Idempotent: same-status events are no-ops, so provider retries are safe.
- The caller's IP is logged for security events only when `ESIGN_TRUST_PROXY=true`
  says a proxy rewriting `x-forwarded-for` is in front (`src/proxy.ts`).

## Transport & abuse controls (`src/app.ts`, `src/server.ts`)

The service is a Fetch app, so helmet, cors and express-rate-limit are gone;
their equivalents are hand-set here.

- **Baseline security headers** (`SECURITY_HEADERS` in `src/app.ts`) on every
  response that does not carry its own: a fail-closed CSP
  (`default-src 'none';frame-ancestors 'none'`), `nosniff`, `X-Frame-Options:
  DENY`, `Referrer-Policy: no-referrer`, `Cross-Origin-Resource-Policy:
  same-origin` and HSTS. The signing pages bring their own nonce-based CSP
  (below) and keep it.
- **CORS**: allow-list from `ESIGN_CORS_ALLOWED_ORIGINS` (comma-separated),
  echoed back with `Vary: origin`; empty means same-origin only. The mint's
  preflight is the package preset's (`createHostedFormApp`, or
  `createEnvelopeApp` under `ESIGN_MINT_MODE=envelope`); `/graphql` gets its
  own preflight.
- **Rate limiting** is **container-only** (`src/server.ts`): an in-memory
  fixed window per client, per route, per minute — 60 on
  `/webform/instance`, 60 on `/envelope/instance`, 120 on `/webhook/esign`,
  100 on `/graphql`, settable with
  `RATE_LIMIT_{WEBFORM,ENVELOPE,WEBHOOK,GRAPHQL}_PER_MIN` (`0` switches a route's
  limit off, for a deployment behind its own gateway). A function relies on
  its platform instead. The window map is swept so a flood cannot grow the
  heap without bound.
- **`ESIGN_TRUST_PROXY`**: `x-forwarded-for` is believed — for the rate-limit key
  and the webhook's security log — only when the deployment says a trusted
  proxy rewrites it. It is an explicit variable, not something inferred from
  the environment.
- **Body limits**: the package's Express router caps JSON/text bodies at
  64 kb (`bodyLimit`, `packages/esign-node/src/express.ts`); a Fetch
  deployment relies on its platform's request limit.
- **Apollo**: introspection is off unless `ESIGN_GRAPHQL_INTROSPECTION=true`; stack traces
  are never returned (`includeStacktraceInErrorResponses: false`).

## Signing pages (`packages/esign-node/src/pages.ts` and `src/providers/docusign/{bridge,mockWebFormPage}.ts`)

The service serves them as Fetch responses (`src/providers/pages.ts` over the
package's `signingPageResponse`); the package's Express router is the other
spelling of the same pages.

- Served with a strict, per-response **nonce-based CSP** (`default-src 'none'`,
  `script-src 'nonce-…'`); no `unsafe-inline`. Buttons use `data-event` +
  `addEventListener`, not inline handlers.
- `frame-ancestors *` is intentional: these pages carry no secrets (the event
  payload is a fixed enum) and must be embeddable by any host integrating the
  SDK.
- Interpolated values are allow-list sanitized; the `<script>`-embedded JSON
  escapes `<` (defense in depth against `</script>` breakout).
- The mock provider's pages exist for manual testing and the E2E suites only;
  `ESIGN_MOCK_PAGES=false` turns them off, and a non-mock provider never serves
  them.

## The prefill callback

`ESIGN_PREFILL_URL` (`src/prefill.ts`) is what keeps a client value from
becoming a locked one: the host's `{ prefill }` wins over the client's values
key by key, and a non-2xx, a timeout or a reply without a prefill object is a
`502` — never a fallback to minting what the client sent.

That request forwards the caller's session bearer and `ESIGN_PREFILL_SECRET`,
so a plaintext hop hands both to anyone on the path. **Use `https` unless the
hop is private** (loopback, `*.svc`, `*.svc.cluster.local`, `*.internal`).
The service no longer refuses a plaintext URL: it cannot tell a private
network from a public one by looking at a hostname, and guessing wrong either
blocked a legitimate deployment or gave false assurance.

Under `ESIGN_MINT_MODE=envelope` the callback also receives the client's
`recipient`, and a `recipient` in the host's answer (`{ name, email }`
strings) is who signs; an answered prefill outside the envelope contract or
a malformed recipient is the same `502`.

**Without `ESIGN_PREFILL_URL`, the caller chooses the envelope's signer.** Any
authenticated caller sends the recipient's name and email, and the DocuSign
envelope client uses that email as the signer's `clientUserId`. The Web
Forms mint is different: its instance is locked to the session's user id. A
deployment that needs the signer tied to the account sets `ESIGN_PREFILL_URL`.
The boot banner reports `prefill  client-supplied` when it is unset, and
`ESIGN_STRICT=true` refuses to start — both of which cover the signer as well
as the prefill.

## Logging & telemetry

- Attacker-influenced fields are CR/LF-sanitized before logging
  (`sanitizeForLog`, `packages/esign-node/src/log.ts`) to prevent log forging.
- No secrets or PII in logs or OpenTelemetry spans — span attributes carry
  ids/statuses/types only, matching the audit-metadata allow-list.
- A minted URL carries a five-minute instance token, so it is a credential:
  it is never logged.

## Input validation

`packages/esign-node/src/validation.ts`: non-empty checks plus max-length caps
(`contractType` ≤ 100, `recipient.name` ≤ 200) bound storage/log
amplification; email is format-checked. The mint's own prefill contract is
`parseWebFormPrefill` (`packages/esign-node/src/providers/docusign/prefill.ts`),
which rejects out-of-contract values with a `400` before any provider call.
The envelope mint's is `parseEnvelopePrefill` (same file); its `recipient`
must be `{ name, email }` strings and then passes the same name and email
checks as a GraphQL recipient.

## Environment variables

Every variable, with why it exists and how to obtain its value, is generated
from one registry (`packages/esign-service/src/env/registry.ts`) into
[the development guide](../development-guide.md#environment-variables-reference),
[the production runbook](../operations/production.md) and
`packages/esign-service/.env.example`. `make docs-check` fails when they
drift, and a variable read without an entry fails a test.

The security-relevant ones in one line each:

| Variable | Effect when unset |
|---|---|
| `ESIGN_SESSION_JWKS_URL` /<br>`ESIGN_SESSION_SECRET` | the bearer token is taken as the user id,<br>reported as `session not verified` |
| `ESIGN_SESSION_ISSUER` /<br>`ESIGN_SESSION_AUDIENCE` | not enforced — any token the key material<br>verifies is accepted |
| `ESIGN_PREFILL_URL` | the client's own prefill (and an envelope's<br>signer) is minted as sent |
| `DOCUSIGN_HMAC_KEY` | an unsigned webhook is accepted when<br>envelopes are on |
| `ESIGN_TRUST_PROXY` | `x-forwarded-for` is ignored — the socket<br>address is the client |
| `ESIGN_CORS_ALLOWED_ORIGINS` | same-origin only |
| `ESIGN_GRAPHQL_INTROSPECTION` | introspection is off |
| `ESIGN_STRICT` | every row above is reported, not refused |
