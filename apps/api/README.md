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
- **Domain in the package**: authorization, validation, persistence with an
  audit trail, the restart rule and the webhook state machine are
  `createEnvelopeService` from `@blinkbitcoin/esign-server`, composed in
  `src/services.ts`; resolvers never query inline. `src/store.ts` is the
  Knex implementation of the package's `EnvelopeStore` port (transactions
  for atomic writes).
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

## Deploy

The service ships as a container (`apps/api/Dockerfile`, built from the repo
root so the workspace lockfile and `packages/esign-server` are inputs):

```sh
make docker-build                     # → esign-api (node 24 alpine, production deps only)
make docker-smoke                     # boots it with the mock provider, checks /health
docker run --rm --env-file apps/api/.env esign-api npm run migrate   # once per database
docker run --rm -p 4000:4000 --env-file apps/api/.env esign-api      # serve
```

Configuration is the same `.env` as local (`.env.example`); with
`ESIGN_PROVIDER=docusign` the JWT credentials and `DOCUSIGN_HMAC_KEY` are
required at boot (fail-closed). The image runs as the unprivileged `node`
user, exposes `4000` (`PORT` overrides) and carries a `/health` healthcheck.
Hosts that would rather not run a service import `@blinkbitcoin/esign-server`
instead (one function call, a Fetch handler, or the Express router).

## Key Paths

| Path | Purpose |
|------|---------|
| `src/typeDefs.ts` → `schema.graphql` | GraphQL SDL → emitted schema artifact |
| `src/schema.ts` | Resolvers |
| `src/providers/port.ts` | `ESignProvider` interface (the provider boundary) |
| `src/providers/docusign/` / `src/providers/mock.ts` | Provider adapters (factory in `providers/index.ts`) |
| `src/services.ts` / `src/store.ts` | Domain composition (`createEnvelopeService`) / Knex `EnvelopeStore` |
| `src/app.ts` | Mounts the package's Express router (`/health`, signing pages, `/webform/instance`, `/webhook/esign`) with this service's auth, CORS and rate limits |
| `src/auth.ts` | HS256 JWT verification, dev/prod split |
| `migrations/` | Knex migrations (TypeScript, run via tsx) |
| `tests/` / `tests/e2e/` | Unit (mocked DB) / E2E (real DB) |

Full documentation: [architecture](../../docs/architecture/backend.md) ·
[API contracts](../../docs/architecture/api-contracts.md) ·
[data models](../../docs/architecture/data-models.md) ·
[real-DocuSign setup](../../docs/integration/docusign-proxy.md)
