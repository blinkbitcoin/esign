# Architecture - Backend

**Part:** backend
**Type:** Express + Apollo GraphQL API
**Updated:** 2026-07-02

## Technology Stack

| Category | Technology | Version |
|----------|------------|---------|
| Framework | Express | 5.2.x |
| GraphQL | Apollo Server | 5.5.x |
| Language | TypeScript | 6.0.x |
| Query Builder | Knex.js | 3.3.x |
| Database Driver | pg | 8.22.x |
| Database | PostgreSQL | 15+ |
| Testing | Vitest | 4.1.x |
| HTTP Testing | Supertest | 7.2.x |
| Lint/Format | Biome | 2.5.x |
| Dev Runner | tsx (watch mode) | 4.x |

## Architecture Pattern

**Provider Pattern + Repository Layer** with clean separation of concerns:

```
HTTP Request
    ↓
Express Router
    ↓
┌───────────────────────────────────────────┐
│  Apollo Server (GraphQL)   Webhook Route  │
│  └── Resolvers             /webhook/esign │
│      └── ESignProvider Interface          │
│          ├── DocuSignProvider             │
│          └── MockProvider                 │
└───────────────────────────────────────────┘
    ↓
Repository functions (envelope.ts, audit.ts)
    ↓
Knex → PostgreSQL
```

## Source Structure

```
apps/api/src/
├── index.ts          # Bootstrap (dotenv + startServer)
├── server.ts         # HTTP server startup (testable startServer factory)
├── app.ts            # Express + Apollo setup (createApp factory)
├── schema.ts         # GraphQL typeDefs + resolvers
├── db.ts             # Knex instance (fail-fast on missing DATABASE_URL)
├── auth.ts           # JWT verification (HS256) with dev/prod split
├── providers/        # Hexagonal provider layer
│   ├── port.ts       #   ESignProvider port + supportsWebForms
│   ├── index.ts      #   Factory (ESIGN_PROVIDER) + tracing-wrapped singleton
│   ├── mock.ts       #   Mock adapter (mirrors DocuSign locally)
│   └── docusign/     #   DocuSign adapter split: index (adapter),
│                     #   client (JWT/OAuth+retry+HTTP), mapping, config
├── signingPages.ts   # Mock signing/web-form pages + return-URL bridge
├── config.ts         # Boot-time security validation (fail-closed)
├── tracing.ts        # OTel domain spans + provider instrumentation
├── log.ts            # CRLF-safe log sanitizer
├── envelope.ts       # Envelope repository (Knex CRUD)
├── webhook.ts        # Generic webhook processing (HMAC policy + status sync)
├── audit.ts          # Audit logging repository
├── errors.ts         # GraphQL error factories with typed codes
├── types.ts          # Shared types incl. ESignProvider interface
└── __mocks__/
    └── db.ts         # knex-mock-client instance for unit tests

apps/api/migrations/    # Knex migrations (TypeScript, run via tsx)
apps/api/knexfile.ts    # Knex CLI configuration
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

  // Optional capability: mint a prefilled DocuSign Web Forms instance
  // (callers gate on supportsWebForms(provider))
  createWebFormInstance?(userId: string, prefill: WebFormPrefill): Promise<WebFormInstanceResult>;
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
a case to the factory in `providers/index.ts`. No schema, client, or HTTP-layer
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
- Raw body is used for verification (`express.text()`) - re-serializing JSON
  would invalidate the signature

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
- Instruments the full stack: http, express, graphql (resolver spans),
  pg (per-query spans - transactions appear as BEGIN/INSERT/COMMIT), and
  undici (`fetch` - the DocuSign API calls)
- Initialized in `index.ts` BEFORE server modules load (require-time
  patching); spans are flushed on SIGTERM/SIGINT

Domain spans (`src/tracing.ts`, zero-cost no-ops when tracing is off):

| Span | Where | Key attributes |
|------|-------|----------------|
| `esign.provider.create_envelope` | provider boundary | `esign.provider`, `esign.contract_type`, `enduser.id`, `esign.provider_envelope_id` |
| `esign.provider.get_signing_url` / `get_envelope_status` | provider boundary | `esign.provider`, `esign.provider_envelope_id`, `esign.envelope_status` |
| `esign.provider.verify_webhook` / `parse_webhook_event` | provider boundary | `esign.webhook.verified` / `esign.webhook.malformed` |
| `esign.webhook.process` | webhook handler | `esign.webhook.status`, `esign.webhook.outcome` (`updated` / `unchanged` / `unknown_envelope` / `ignored_unknown_status`) |
| (request span) | GraphQL context | `enduser.id` on every authenticated request |

The provider spans are applied **in the factory** (`instrumentProvider` in
`providers/index.ts`), so future adapters are instrumented by construction. Span
attributes follow the audit-metadata PII discipline: ids, types, and
statuses only - never recipient names, emails, or document content.

## Database Schema

Managed by Knex migrations in `apps/api/migrations/` (see
[data-models.md](data-models.md) for full details).

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

### Unit Tests (`apps/api/tests/`)
- Vitest; 100% statement/branch/function/line coverage enforced culture
- Database globally mocked (`tests/setup.ts` auto-mocks `src/db`); repository
  tests use `knex-mock-client` trackers, consumer tests mock the repository
  modules
- `npm test`

### E2E Tests (`apps/api/tests/e2e/`)
- Real PostgreSQL via Docker Compose (tmpfs-backed, port 5433)
- Separate config (`vitest.e2e.config.ts`, sequential execution)
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
| `PORT` | Server port (default: 4000) |

Full reference (every variable, incl. optional overrides and OTEL):
[development-guide.md](../development-guide.md#environment-variables-reference);
runnable template: `apps/api/.env.example`.

## Entry Points

| File | Purpose |
|------|---------|
| `src/index.ts` | Bootstrap (env loading + startServer) |
| `src/server.ts` | `startServer(port)` - testable listen/log logic |
| `src/app.ts` | `createApp()` factory for testability |
| `POST /graphql` | GraphQL endpoint |
| `POST /webhook/esign` | Provider webhook endpoint |
| `GET /health` | Health check |
