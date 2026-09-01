# Integration Architecture

**Project:** @blinkbitcoin/esign-react-native monorepo (npm workspaces)
**Updated:** 2026-07-02

## Parts

| Part | Root | Type | Role |
|------|------|------|------|
| `library` | `packages/esign-react-native/` | Publishable RN library | The product: signing UI component + Apollo client factory |
| `backend` | `apps/api/` | Express + Apollo API | The main service: envelope orchestration, persistence, webhooks |
| `demo` | `examples/react-native-demo/` | RN app | Integration demo hosting the library (manual + Maestro E2E) |

## Integration Points

### 1. Library → Backend: GraphQL over HTTP

- **From:** `packages/esign-react-native/src/client.ts` (Apollo Client 4, `createESignApolloClient` factory)
- **To:** `apps/api/src/app.ts` `/graphql` (Apollo Server 5)
- **URL resolution:** host app's concern - the demo resolves it in `examples/react-native-demo/src/config.ts` — iOS simulator `localhost:4000`,
  Android emulator `10.0.2.2:4000` (host alias), physical devices need the
  host LAN IP
- **Auth:** `Authorization: Bearer <token>` attached by a `SetContextLink`;
  backend resolves it in `src/auth.ts` (HS256 JWT when `JWT_SECRET` set,
  dev passthrough otherwise)
- **Operations:** `createEnvelope`, `getSigningUrl` mutations
  (`packages/esign-react-native/src/operations.ts` ↔ `apps/api/src/schema.ts`)

### 2. Shared Error-Code Contract (schema-borne, generated)

The GraphQL `extensions.code` values form the wire contract between parts.
The contract's source of truth is the `ErrorCode` enum in
`apps/api/schema.graphql` (emitted from `src/typeDefs.ts` via
`npm run schema:emit`); each client package runs GraphQL Codegen against it
(`make codegen`) and a parity test asserts its `ErrorCodes` map matches the
generated enum. Drift fails tests locally and a dedicated CI step:

`UNAUTHORIZED`, `VALIDATION_ERROR`, `ENVELOPE_NOT_FOUND`,
`ENVELOPE_CREATION_FAILED`, `PROVIDER_UNAVAILABLE`, `SESSION_EXPIRED`
(+ backend-only `PERSISTENCE_FAILED`, mobile-only fallbacks
`UNKNOWN_ERROR`, `RESTART_FAILED`, `NETWORK_ERROR`, `MISSING_ENVELOPE_ID`,
`SIGNING_ERROR`).

Changing a code is a **breaking cross-part change**: edit the schema enum +
`apps/api/src/errors.ts`, run `make codegen`, and the parity tests point at
every client spot needing updates (ErrorCodes map, getErrorMessage copy).

### 3. Mobile WebView ↔ Signing Page: postMessage Events

- **From:** the provider's embedded signing page (URL returned by the backend)
- **To:** `ESignature.handleWebViewMessage` via `window.ReactNativeWebView.postMessage`
- **Protocol:** JSON `{ "event": "<name>", ... }` with events:
  `signing_complete`, `cancel`, `decline`, `session_timeout`, `exception`
- These event names are provider-neutral; a provider whose page emits
  different messages needs a small injected mapping script (mobile concern,
  deliberately outside the backend provider interface)
- Two backend-served pages complete this protocol layer
  (`apps/api/src/signingPages.ts`): `/signing/mock/:id` - the mock
  provider's interactive signing page (what Maestro E2E drives) - and
  `/signing/return` - the bridge translating real DocuSign's redirect
  protocol (`?event=...`) into these postMessage events
  (see [../integration/docusign-proxy.md](../integration/docusign-proxy.md))

### 4. Provider → Backend: Webhook Callbacks

- **From:** e-sign provider (DocuSign Connect, or the mock mirroring it)
- **To:** `POST /webhook/esign` (`apps/api/src/app.ts`)
- **Verification/parsing:** delegated to the configured provider
  (`ESignProvider.verifyWebhook` / `parseWebhookEvent`); DocuSign uses
  HMAC-SHA256 over the raw body in `X-DocuSign-Signature-1`
- **Processing:** `handleWebhookEvent` — idempotent, transactional status
  sync; 500 on transient failure triggers provider retry

### 5. Backend → DocuSign: REST API

- **From:** `apps/api/src/providers/docusign/` (the only file that talks to DocuSign)
- **To:** DocuSign eSignature REST API v2.1 (`DOCUSIGN_BASE_URL`) and OAuth
  (`DOCUSIGN_OAUTH_URL`, JWT Grant with RS256 assertion)
- **Resilience:** exponential-backoff retry (3 attempts) on network/5xx/429;
  token cache with concurrent-refresh dedup

### 6. Backend → PostgreSQL

- **From:** repository modules via shared Knex instance (`apps/api/src/db.ts`)
- **Schema:** `Envelope` + `AuditLog` (see
  [data-models.md](data-models.md))

## End-to-End Data Flow

```
User taps Sign
  → mobile checks connectivity (NetInfo)
  → createEnvelope mutation ──────────────► backend resolver
                                              → provider.createEnvelope (DocuSign/mock)
                                              → DB: envelope + audit log (transaction)
  ◄── { envelopeId: internal UUID, signingUrl }
  → WebView loads signingUrl
  → user signs on provider page
  → page posts signing_complete ──► onComplete callback

  (async) provider webhook ───────────────► /webhook/esign
                                              → verify + parse (provider adapter)
                                              → DB: status + audit log (transaction)
```

The internal UUID is the only envelope identifier that crosses the
mobile↔backend boundary; the provider's envelope ID never leaves the backend.

## E2E Integration Testing

- **Maestro** (`examples/react-native-demo/.maestro/`) drives the mobile UI
  against a real backend (`ESIGN_PROVIDER=mock`) + the dockerized test
  database, interacting with the real mock signing page inside the WebView —
  exercising integration points 1, 3, and 6. Flows: happy path,
  cancel-from-signing-page, session-timeout → restart → complete
- **Backend E2E** (`apps/api/tests/e2e/`) exercises points 4 and 6 against
  real Postgres, including the full webhook signature/parsing path
- **CI:** `.github/workflows/e2e-backend.yml`, `e2e-web.yml`, `e2e-mobile.yml`; `publish.yml` releases the packages to GitHub Packages
- **Playwright** (`examples/react-demo/e2e/`) drives the web demo in real
  Chromium against the same backend+DB stack — the Vite app (:5173) embeds
  the mock signing page (:4000) in a genuinely cross-origin iframe, so the
  window.postMessage path is exercised for real. Same four journeys as
  Maestro: smoke, happy path, cancel-from-page, timeout → restart
  (`make e2e-web` at the repo root runs the full lifecycle)

## Shared Dependencies

| Dependency | Library/Demo | Backend | Must stay compatible |
|------------|--------|---------|----------------------|
| `graphql` | 16.x (unified) | 16.x | Yes — hoisted to ONE copy repo-wide; Apollo Server 5 pins 16.x, so do not bump to 17 until it supports it |
| Error codes | `packages/esign-react-native/src/client.ts` | `apps/api/src/errors.ts` | Yes — wire contract |
| WebView events | `ESignature.tsx` | mock signing page | Yes — signing protocol |
