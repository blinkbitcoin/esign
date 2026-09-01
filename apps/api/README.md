# apps/api — E-Sign Service

Express 5 + Apollo Server 5 GraphQL API that orchestrates e-signature
envelopes against a provider (DocuSign, or a local mock), persists them via
Knex/PostgreSQL, and syncs status through provider webhooks.

This is **the main service** of the monorepo; the `@blinkbitcoin/esign-react*`
packages are its client SDKs.

## Quick Start

```sh
# From repo root, once per machine:
direnv allow . && direnv allow apps/api   # env + nix dev shell

# From this directory:
make db-up          # dev Postgres (docker, port 5432)
make migrate        # Knex migrations
make dev            # server at http://localhost:4000/graphql
```

`make help` lists all targets. Environment comes from `.env` (see
`.env.example` for every variable, including the fail-closed production
semantics of `DOCUSIGN_HMAC_KEY` and `JWT_SECRET`).

## Architecture in Brief

- **Provider boundary**: all DocuSign-specific code lives in
  `src/providers/docusign/` behind the `ESignProvider` port
  (`src/providers/port.ts`) — including webhook verification/parsing and the
  optional Web Forms capability. New providers = an adapter + a factory case
  in `src/providers/index.ts`.
- **Wire contract**: the `ErrorCode` enum in `schema.graphql` (emitted from
  `src/typeDefs.ts` via `make schema-emit`). Client packages codegen from it;
  parity tests + a CI step fail on drift.
- **Repositories**: resolvers never query inline — `src/envelope.ts` /
  `src/audit.ts`, with optional Knex transactions for atomic writes.
- **ID protection**: clients only ever see internal UUIDs; provider envelope
  IDs never leave this service.
- **Fail-fast / fail-closed**: missing provider config aborts startup;
  missing HMAC/JWT secrets reject requests in production.
- **Observability**: opt-in OpenTelemetry tracing via standard `OTEL_*` env
  vars (`src/instrumentation.ts`) - http/express/graphql/pg spans to any
  OTLP backend, or `OTEL_TRACES_EXPORTER=console` locally.

## Testing

```sh
make test           # 314 unit tests (Vitest, DB mocked) - 100% coverage (enforced threshold)
make migrate-test   # migrations against the tmpfs test DB (start it first:
                    #   docker compose -f ../../docker-compose.test.yml up -d --wait)
make e2e            # 14 E2E tests against real Postgres
```

## Key Paths

| Path | Purpose |
|------|---------|
| `src/typeDefs.ts` → `schema.graphql` | GraphQL SDL → emitted schema artifact |
| `src/schema.ts` | Resolvers |
| `src/providers/port.ts` | `ESignProvider` interface (the provider boundary) |
| `src/providers/docusign/` / `src/providers/mock.ts` | Provider adapters (factory in `providers/index.ts`) |
| `src/webhook.ts` | Generic webhook processing (idempotent, transactional) |
| `src/signingPages.ts` | Mock signing page + real-DocuSign return-URL bridge |
| `src/auth.ts` | HS256 JWT verification, dev/prod split |
| `migrations/` | Knex migrations (TypeScript, run via tsx) |
| `tests/` / `tests/e2e/` | Unit (mocked DB) / E2E (real DB) |

Full documentation: [architecture](../../docs/architecture/backend.md) ·
[API contracts](../../docs/architecture/api-contracts.md) ·
[data models](../../docs/architecture/data-models.md) ·
[real-DocuSign setup](../../docs/integration/docusign-proxy.md)
