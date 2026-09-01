# Security Model — apps/api

**Updated:** 2026-07-03

Summary of the backend's security posture after the OWASP audit remediation.
Controls are enforced at boot and per-request; the defaults are fail-closed.

## Boot-time enforcement (fail-closed)

`validateSecurityConfig` (`src/config.ts`) runs before the server accepts
connections and **refuses to start** when a required secret is missing:

- `JWT_SECRET` — always required
- `DOCUSIGN_HMAC_KEY` — required when `ESIGN_PROVIDER=docusign`

The only escape hatch is an explicit `ALLOW_INSECURE_DEV=true`, which logs a
loud warning and permits running without the secrets (local dev, CI, and the
E2E suites against the mock provider). **This is deliberately NOT gated on
`NODE_ENV`** — a missing or mistyped `NODE_ENV` can no longer silently open
authentication or webhook verification.

## Authentication (`src/auth.ts`)

- HS256 JWT verification, timing-safe signature comparison, algorithm fixed in
  code (immune to `alg=none` / RS256→HS256 confusion)
- `exp` is **required** and enforced (a token without expiry is rejected)
- Without `JWT_SECRET`: unauthenticated unless `ALLOW_INSECURE_DEV=true`, in
  which case the bearer token is treated as the userId (dev passthrough)

## Authorization

Every resolver checks `context.userId`, then scopes data access by owner
(`WHERE { id, userId }`). Not-found and wrong-owner are indistinguishable (no
existence oracle). `providerEnvelopeId` is never returned to clients.

## Webhooks (`src/webhook.ts`, `src/app.ts`)

- HMAC-SHA256 over the raw body, timing-safe compare; missing/invalid
  signature → 401. Fail-closed unless `ALLOW_INSECURE_DEV=true`.
- **Terminal-state machine**: no transition out of `completed`/`voided`/
  `declined`. Blocks replay-downgrades (a captured, validly-signed older
  `sent` webhook can't reopen a finished envelope).
- Idempotent: same-status events are no-ops, so provider retries are safe.

## Transport & abuse controls (`src/app.ts`)

- **helmet** baseline headers on all responses (nosniff, HSTS, etc.)
- **Rate limiting**: 100 req/min on `/graphql`, 120 req/min on `/webhook/esign`, 60 req/min on `/webform/instance`
- **CORS**: allow-list from `CORS_ALLOWED_ORIGINS` (comma-separated); no
  cross-origin access by default
- **Body limits**: 64 kb on JSON/text bodies
- **Apollo**: introspection disabled in production; stack traces never returned
- `trust proxy` enabled in production so rate-limit/IP reflect the real client

## Signing pages (`src/signingPages.ts`)

- Served with a strict, per-response **nonce-based CSP** (`default-src 'none'`,
  `script-src 'nonce-…'`); no `unsafe-inline`. Buttons use `data-event` +
  `addEventListener`, not inline handlers.
- `frame-ancestors *` is intentional: these pages carry no secrets (the event
  payload is a fixed enum) and must be embeddable by any host integrating the
  SDK.
- Interpolated values are allow-list sanitized; the `<script>`-embedded JSON
  escapes `<` (defense in depth against `</script>` breakout).

## Logging & telemetry

- Attacker-influenced fields are CR/LF-sanitized before logging
  (`src/log.ts`) to prevent log forging.
- No secrets or PII in logs or OpenTelemetry spans — span attributes carry
  ids/statuses/types only, matching the audit-metadata allow-list.

## Input validation

Non-empty checks plus max-length caps (`contractType` ≤ 100, `recipient.name`
≤ 200) bound storage/log amplification; email is format-checked.

## Environment variables

| Var | Required | Purpose |
|-----|----------|---------|
| `JWT_SECRET` | yes (unless `ALLOW_INSECURE_DEV`) | HS256 signing key |
| `DOCUSIGN_HMAC_KEY` | yes for docusign provider | webhook signature key |
| `ALLOW_INSECURE_DEV` | no | opt into running without the above (never in prod) |
| `CORS_ALLOWED_ORIGINS` | no | comma-separated CORS allow-list |
