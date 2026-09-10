# Architecture - Backend

**Part:** backend
**Type:** Fetch-native service, capability by environment
**Updated:** 2026-09-10

## Technology Stack

| Category | Technology | Version |
|----------|------------|---------|
| Framework | none (a Fetch core); `@hono/node-server` bridges it to Node | 2.1.x |
| GraphQL | Apollo Server (`executeHTTPGraphQLRequest`) | 5.5.x |
| Sessions | jose (JWKS / HS256) | 6.2.x |
| Language | TypeScript | 6.0.x |
| Query Builder | Knex.js | 3.3.x |
| Database Driver | pg | 8.22.x |
| Database | PostgreSQL | 15+ |
| Testing | Vitest (Fetch `Request`/`Response`, no HTTP server) | 4.1.x |
| Lint/Format | Biome | 2.5.x |
| Dev Runner | tsx (watch mode) | 4.x |

## Architecture Pattern

**Provider Pattern + Repository Layer** with clean separation of concerns:

Capabilities come from the environment: the mint is always on, and
`DATABASE_URL` adds envelope orchestration. The envelope half is behind a
dynamic import, so a mint-only deployment never loads Apollo or `pg`.

```
Fetch Request (container, Vercel route, Worker - the same core)
    ↓
createESignApp(env)  - boot guard, session verification, CORS, headers
    ↓
┌────────────────────────────────────────────────────────────┐
│  ALWAYS: POST /webform/instance  → TERMS_URL → the provider │
│          GET  /signing/return, GET /health                  │
│  DATABASE_URL: /graphql (Apollo)   POST /webhook/esign      │
│      └── Resolvers                 └── ESignProvider        │
│                                        ├── DocuSignProvider │
│                                        └── MockProvider     │
└────────────────────────────────────────────────────────────┘
    ↓
Envelope service (@blinkbitcoin/esign-node: rules, audit, webhook state machine)
    ↓
EnvelopeStore port → Knex store (store.ts) → PostgreSQL
```

## Source Structure

```
packages/esign-service/src/
├── index.ts          # The library entry: createESignApp + the pure pieces
├── node.ts           # The process entry point (dotenv, telemetry, serve | migrate)
├── server.ts         # ./node: startServer over @hono/node-server, rate limits, drain
├── vercel.ts         # ./vercel: GET/POST/OPTIONS route handlers
├── cloudflare.ts     # ./cloudflare: the Worker default export (mint only)
├── app.ts            # The Fetch core (createESignApp): capabilities → routes, with
│                     #   session verification, locked terms, CORS and the security
│                     #   headers around the package's createHostedFormApp
├── capabilities.ts   # What the environment turns on (pure)
├── session.ts        # Session verification: JWKS or HS256, via jose (pure factory)
├── terms.ts          # The TERMS_URL callback: the host's prefill wins key by key
├── envelopes.ts      # The envelope capability: Fetch webhook + Apollo over Fetch
│                     #   (Node-only; reached only by dynamic import)
├── schema.ts         # typeDefs + resolvers = createESignGraphQL({ envelopes }) from the package
├── services.ts       # Composition root: createEnvelopeService({ provider, store, tracing })
├── store.ts          # Knex implementation of the package's EnvelopeStore port
├── db.ts             # Knex instance (fail-fast on missing DATABASE_URL)
├── env.ts            # The Env type + ALLOW_INSECURE_DEV (nothing depends on it)
├── providers/        # Hexagonal provider layer
│   ├── port.ts       #   ESignProvider port + supportsHostedForms (supportsWebForms kept as alias)
│   ├── index.ts      #   Registry + providerFromEnv (ESIGN_PROVIDER) + tracing-wrapped singleton
│   ├── mock.ts       #   The package's mock adapter, wired to this service's pages
│   ├── pages.ts      #   The mock provider's signing pages as Fetch responses
│   └── docusign/     #   The package's DocuSign adapter wired to the service's
│                     #   config (config.ts) and webhook policy
├── config.ts         # The boot guard: validateConfig(env, { runtime }), pure and
│                     #   fail-closed; lists every problem plus the capabilities on
├── tracing.ts        # OTel domain spans + provider instrumentation
├── errors.ts         # Re-exports the package's coded errors (extensions.code)
├── types.ts          # Re-exports the package's domain types + GraphQLContext
└── __mocks__/
    └── db.ts         # knex-mock-client instance for unit tests

├── migrate.ts        # Applies the package's migrations (@blinkbitcoin/esign-node/knex)
```

## Provider Pattern

### Interface Definition

The interface covers both outbound API calls and inbound webhook callbacks —
a replacement provider implements its own signature scheme and payload format
without the HTTP layer knowing about either.

```typescript
interface ESignProvider {
  createEnvelope(
    userId: string,
    contractType: string,
    recipient: RecipientData
  ): Promise<EnvelopeResult>;

  getEnvelopeStatus(envelopeId: string): Promise<EnvelopeStatus>;

  // New signing URL for an existing envelope (session-expiration restart)
  getSigningUrl(envelopeId: string, recipient: RecipientData): Promise<SigningUrlResult>;

  // Verify an inbound webhook's authenticity (signature headers etc.)
  verifyWebhook(headers: WebhookHeaders, rawBody: string, ip?: string): boolean;

  // Parse a verified webhook body into a normalized event (null = malformed)
  parseWebhookEvent(rawBody: string): WebhookEvent | null;

  // Optional capability: mint a prefilled hosted-form instance (DocuSign:
  // a Web Forms instance). Callers gate on supportsHostedForms(provider) or
  // mint through hostedFormMint(provider), which also honours the deprecated
  // createWebFormInstance name.
  createHostedFormInstance?(userId: string, prefill: HostedFormPrefill): Promise<HostedFormInstanceResult>;
}
```

### Implementations

| Provider | Purpose | Usage |
|----------|---------|-------|
| `DocuSignProvider` | Real DocuSign API + Connect webhooks | Production |
| `MockProvider` | Instant responses; mirrors DocuSign Connect callback format | Development, E2E tests, CI |

Selection via `ESIGN_PROVIDER` environment variable (default: `mock`).
Selecting `docusign` with missing `DOCUSIGN_*` configuration **throws at
startup** (fail-fast) rather than failing per-request.

Adding a new provider: implement the five interface methods in one file, add
an entry to the registry in `providers/index.ts` (the package's
`providerFromEnv` selects it by `ESIGN_PROVIDER`). No schema, client, or HTTP-layer
changes required.

## GraphQL API

### Schema

```graphql
type Mutation {
  createEnvelope(input: CreateEnvelopeInput!): EnvelopeResult!
  getSigningUrl(input: GetSigningUrlInput!): SigningUrlResult!
}

type Query {
  health: HealthCheck!
  envelope(id: String!): Envelope
  auditLogs(envelopeId: String!): [AuditLog!]!
}

input CreateEnvelopeInput {
  contractType: String!
  recipient: RecipientInput!
}

type EnvelopeResult {
  envelopeId: String!   # Internal UUID - never the provider's ID
  signingUrl: String!
}
```

### Resolvers

- **createEnvelope**: Calls the provider, persists envelope + `initiated`
  audit log in a single transaction, returns internal UUID + signing URL
- **getSigningUrl**: Session restart - new signing URL for an owned,
  still-`sent` envelope; logs a `session_restart` audit event
- **envelope**: Retrieves envelope by internal ID (owner-scoped)
- **auditLogs**: Returns audit trail for envelope (owner-scoped)

### Authentication

`Authorization: Bearer <token>` handled by `src/auth.ts`:

- **`JWT_SECRET` set**: token verified as an HS256 JWT (signature + expiry,
  timing-safe comparison); `sub` claim becomes the resolver context `userId`
- **`JWT_SECRET` unset, development**: token treated as an opaque userId
  (placeholder until an identity provider issues tokens)
- **`JWT_SECRET` unset**: fail closed - the server refuses to boot unless
  `ALLOW_INSECURE_DEV=true` is set (then requests use the dev passthrough).
  This is not gated on `NODE_ENV`. See [security.md](security.md).

## Webhook Processing

### Endpoint
`POST /webhook/esign` (provider-agnostic)

### Security
- Signature verification delegated to `provider.verifyWebhook()` before any
  processing (DocuSign: HMAC-SHA256 of the raw body, `X-DocuSign-Signature-1`
  header, keyed by `DOCUSIGN_HMAC_KEY`)
- Missing HMAC key: dev mode allows with a warning; **production rejects all
  webhooks (fail-closed)**
- Raw body is used for verification (`await request.text()`) - re-serializing
  JSON would invalidate the signature

### Flow

[![Webhook Flow](../diagrams/dist/webhook-flow.svg)](../diagrams/src/webhook-flow.mmd)

`handleWebhookEvent()` is generic and provider-neutral: verification and
payload parsing are delegated to the provider adapter.

A transient processing failure (e.g. database outage) returns **500** so the
provider retries later; the handler's idempotency makes retries safe.
Permanent conditions (unknown envelope, untracked status) return 200 so the
provider does not retry pointlessly.

### Supported statuses
`completed`, `declined`, `voided`, `sent` (mapped to the `initiated` audit
action). Unknown statuses are acknowledged and ignored.

## Observability

OpenTelemetry tracing (`src/instrumentation.ts`, house pattern from
blink-kyc) - **opt-in and vendor-neutral**:

- Enabled only when `OTEL_EXPORTER_OTLP_ENDPOINT` or `OTEL_TRACES_EXPORTER`
  is set; silent no-op otherwise (dev/test/CI stay clean)
- Configured entirely through standard `OTEL_*` env vars - no exporter is
  constructed in code, so any OTLP backend works without code changes;
  `OTEL_TRACES_EXPORTER=console` prints spans to stdout for local debugging
- Instruments the full stack: http, graphql (resolver spans), pg (per-query
  spans - transactions appear as BEGIN/INSERT/COMMIT), and undici (`fetch` -
  the DocuSign API calls). The Express instrumentation is gone with Express
- Initialized in `node.ts` BEFORE the server modules load (require-time
  patching); spans are flushed on SIGTERM/SIGINT

Domain spans (`src/tracing.ts`, zero-cost no-ops when tracing is off):

| Span | Where | Key attributes |
|------|-------|----------------|
| `esign.provider.create_envelope` | provider boundary | `esign.provider`, `esign.contract_type`, `enduser.id`, `esign.provider_envelope_id` |
| `esign.provider.get_signing_url` / `get_envelope_status` | provider boundary | `esign.provider`, `esign.provider_envelope_id`, `esign.envelope_status` |
| `esign.provider.verify_webhook` / `parse_webhook_event` | provider boundary | `esign.webhook.verified` / `esign.webhook.malformed` |
| `esign.webhook.process` | webhook handler | `esign.webhook.status`, `esign.webhook.outcome` (`updated` / `unchanged` / `unknown_envelope` / `ignored_unknown_status` / `rejected_terminal` / `rejected_no_transition`) |
| (request span) | GraphQL context | `enduser.id` on every authenticated request |

The provider spans are applied **in the registry entries** (`instrumentProvider` in
`providers/index.ts`), so future adapters are instrumented by construction. Span
attributes follow the audit-metadata PII discipline: ids, types, and
statuses only - never recipient names, emails, or document content.

## Database Schema

Defined by the package's programmatic migration source
(`@blinkbitcoin/esign-node/knex`, applied by `src/migrate.ts`); see
[data-models.md](data-models.md) for full details.

### Envelope
| Column | Type | Notes |
|--------|------|-------|
| id | uuid (text) | Primary key - internal UUID, the only ID clients see |
| providerEnvelopeId | text | Provider's envelope ID, unique, **never exposed** |
| userId | text | Owner |
| contractType | text | |
| status | text | sent, completed, voided, declined |
| createdAt / updatedAt | timestamptz | |

### AuditLog
| Column | Type | Notes |
|--------|------|-------|
| id | uuid (text) | Primary key |
| envelopeId | text | FK → Envelope.id, ON DELETE CASCADE |
| action | text | initiated, completed, failed, voided, declined, session_restart, creation_failed |
| timestamp | timestamptz | |
| metadata | jsonb | Sanitized to an allow-list - no PII |

## Testing Strategy

### Unit Tests (`packages/esign-service/tests/`)
- Vitest; 100% statement/branch/function/line coverage enforced culture
- Database globally mocked (`tests/setup.ts` auto-mocks `src/db`); the Knex
  store test uses a `knex-mock-client` tracker, resolver/route tests run the
  real domain over the package's in-memory store (`vi.mock('../src/store')`)
- `npm test`

### E2E Tests (`packages/esign-service/tests/e2e/`)
- Real PostgreSQL via Docker Compose (tmpfs-backed, port 5433)
- Separate config (`vitest.e2e.config.mts`, sequential execution)
- Factory pattern for test data; env from `.env.test` via dotenv-cli

```bash
docker-compose -f docker-compose.test.yml up -d --wait
npm run migrate:test
npm run test:e2e
```

## Security Features

| Feature | Implementation |
|---------|----------------|
| Webhook signature validation | Provider-delegated; HMAC-SHA256, timing-safe compare, fail-closed in prod |
| JWT verification | HS256 via `JWT_SECRET`; fail-closed in prod when unset |
| ID protection | Internal UUIDs only; provider envelope IDs never exposed |
| User scoping | All envelope queries filtered by userId (no info leak on miss) |
| Audit logging | All actions tracked; metadata sanitized against a PII allow-list |
| Fail-fast config | Missing provider config or DATABASE_URL aborts startup |

## Environment Variables

| Variable | Purpose |
|----------|---------|
| `DATABASE_URL` | PostgreSQL connection string (required) |
| `ESIGN_PROVIDER` | Provider selection: `mock` (default) / `docusign` |
| `DOCUSIGN_*` | DocuSign credentials (required when provider=docusign) |
| `DOCUSIGN_HMAC_KEY` | Webhook HMAC key (fail-closed in prod when unset) |
| `JWT_SECRET` | HS256 JWT verification key (fail-closed in prod when unset) |
| `PORT` | Server port (default: `ESIGN_PORT_BASE` + 0 = 4100) |

Full reference (every variable, incl. optional overrides and OTEL):
[development-guide.md](../development-guide.md#environment-variables-reference);
runnable template: `packages/esign-service/.env.example`.

## Entry Points

| File | Purpose |
|------|---------|
| `src/index.ts` | Bootstrap (env loading + startServer) |
| `src/server.ts` | `startServer(port)` - testable listen/log logic |
| `src/app.ts` | `createApp()` factory for testability |
| `POST /graphql` | GraphQL endpoint |
| `POST /webhook/esign` | Provider webhook endpoint |
| `GET /health` | Health check |
