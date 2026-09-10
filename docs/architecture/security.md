# Security Model — packages/esign-service

**Updated:** 2026-09-10

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

- **no session source**: neither `SESSION_JWKS_URL` nor `SESSION_HS256_SECRET`
  (`JWT_SECRET` is an accepted alias)
- an unknown `ESIGN_PROVIDER`, or a provider missing what a mint needs
- under `ESIGN_ENV=production`: the mock provider, and DocuSign hosts still
  pointing at the sandbox (`ESIGN_ALLOW_DEMO=true` is the one bypass)
- under `ESIGN_ENV=production`: no `TERMS_URL`, unless
  `ESIGN_ALLOW_CLIENT_PREFILL=true`; and a plaintext `http:` `TERMS_URL`
  unless the host is private (loopback, `*.svc`, `*.svc.cluster.local`,
  `*.internal`) or `TERMS_ALLOW_INSECURE=true`
- `DOCUSIGN_HMAC_KEY` missing when envelopes are on **and** the provider is
  `docusign`
- `DATABASE_URL` on the Cloudflare runtime (no Postgres driver there)

The only escape hatch is an explicit `ALLOW_INSECURE_DEV=true`, which logs a
loud warning and permits running without session verification and without a
webhook key (local dev, CI, and the E2E suites against the mock provider).

**None of this is gated on `NODE_ENV`** — every Node image sets it, so it says
nothing about the e-signature configuration. `ESIGN_ENV=production` is the
production switch, and the image sets it by default.

## Authentication (`src/session.ts`)

One session source, chosen by the environment alone, verified with `jose`:

- `SESSION_JWKS_URL` — RS/ES tokens against a remote, cached key set. The
  algorithm allow-list is **asymmetric only** (`RS*`, `ES*`, `PS256`), so a
  JWKS deployment can never be talked into accepting an HS256 token signed
  with the public key (the classic RS→HS confusion attack).
- `SESSION_HS256_SECRET` (alias `JWT_SECRET`) — a shared secret, `HS256` only.
- `ALLOW_INSECURE_DEV=true` — no verification: the bearer token *is* the user
  id, with a warn-once log line. Local dev and the CI smoke only.

`exp` is a **required** claim (a token without an expiry would be valid
forever, and nothing here can revoke one); `SESSION_ISSUER` / `SESSION_AUDIENCE`
are enforced when set; the user id comes from `SESSION_USER_CLAIM` (default
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
  (`ALLOW_INSECURE_DEV=true`).
- **Terminal-state machine**: no transition out of `completed`/`voided`/
  `declined`. Blocks replay-downgrades (a captured, validly-signed older
  `sent` webhook can't reopen a finished envelope).
- Idempotent: same-status events are no-ops, so provider retries are safe.
- The caller's IP is logged for security events only when `TRUST_PROXY=true`
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
- **CORS**: allow-list from `CORS_ALLOWED_ORIGINS` (comma-separated),
  echoed back with `Vary: origin`; empty means same-origin only. `/graphql`
  gets its own preflight.
- **Rate limiting** is **container-only** (`src/server.ts`): an in-memory
  fixed window per client, per route, per minute — 60 on
  `/webform/instance`, 120 on `/webhook/esign`, 100 on `/graphql`, settable
  with `RATE_LIMIT_{WEBFORM,WEBHOOK,GRAPHQL}_PER_MIN` (`0` switches a route's
  limit off, for a deployment behind its own gateway). A function relies on
  its platform instead. The window map is swept so a flood cannot grow the
  heap without bound.
- **`TRUST_PROXY`**: `x-forwarded-for` is believed — for the rate-limit key
  and the webhook's security log — only when the deployment says a trusted
  proxy rewrites it. It is an explicit variable, not something inferred from
  the environment.
- **Body limits**: the package's Express router caps JSON/text bodies at
  64 kb (`bodyLimit`, `packages/esign-node/src/express.ts`); a Fetch
  deployment relies on its platform's request limit.
- **Apollo**: introspection is off under `ESIGN_ENV=production`; stack traces
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
  `MOCK_PAGES=false` turns them off, and a non-mock provider never serves
  them.

## Locked terms

`TERMS_URL` (`src/terms.ts`) is what keeps a client value from becoming a
locked one: the host's `{ prefill }` wins over the client's values key by
key, and a non-2xx, a timeout or a reply without a prefill object is a `502`
— never a fallback to minting what the client sent. Because that request
forwards the caller's session bearer and `TERMS_SHARED_SECRET`, the boot
guard requires `https` in production (see above).

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

## Environment variables

The full table is the service README's
[Environment](../../packages/esign-service/README.md#environment) section and
`packages/esign-service/.env.example`. The security-relevant ones:

| Var | Required | Purpose |
|-----|----------|---------|
| `SESSION_JWKS_URL` | one of the two<br>(unless `ALLOW_INSECURE_DEV`) | remote key set (RS/ES) |
| `SESSION_HS256_SECRET` | one of the two<br>(unless `ALLOW_INSECURE_DEV`) | shared secret (`JWT_SECRET` alias) |
| `SESSION_ISSUER`,<br>`SESSION_AUDIENCE`,<br>`SESSION_USER_CLAIM` | no | enforced when set; claim default `sub` |
| `ESIGN_ENV` | prod | `production` refuses demo settings and<br>disables introspection |
| `ESIGN_ALLOW_DEMO` | no | the one bypass of that refusal |
| `TERMS_URL` | prod, unless<br>`ESIGN_ALLOW_CLIENT_PREFILL` | where the host computes the locked prefill |
| `TERMS_SHARED_SECRET` | no | sent as `x-esign-terms-secret` |
| `TERMS_ALLOW_INSECURE` | no | opt into a plaintext `TERMS_URL` in prod |
| `ESIGN_ALLOW_CLIENT_PREFILL` | no | mint the client's own prefill in prod |
| `DOCUSIGN_HMAC_KEY` | envelopes + docusign | webhook signature key |
| `ALLOW_INSECURE_DEV` | no | opt into running without the above<br>(never in prod) |
| `CORS_ALLOWED_ORIGINS` | no | comma-separated CORS allow-list |
| `TRUST_PROXY` | no | believe `x-forwarded-for` (container only) |
| `RATE_LIMIT_*_PER_MIN` | no | per-route limits, `0` disables (container only) |
