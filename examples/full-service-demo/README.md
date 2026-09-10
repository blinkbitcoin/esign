# examples/full-service-demo — the whole service, as a reference host

Express 5 + Apollo Server 5 GraphQL API composed from
`@blinkbitcoin/esign-node`: the package's Express router, envelope domain,
Postgres store and provider adapters (DocuSign, or a local mock), wired to
this host's auth, CORS, rate limits, config validation and telemetry.

It is one of the three server shapes the package supports (see
[`examples/`](../README.md)) and the backend the two client demos and every
E2E suite run against. Nobody deploys it as a product; the `esign-api`
image exists so a host team can run it locally or start from it.

## Quick Start

```sh
# From repo root, once per machine:
direnv allow . && direnv allow examples/full-service-demo   # env + nix dev shell

# From this directory:
make db-up          # dev Postgres (docker, port 5432)
make migrate        # the package's migrations (src/migrate.ts)
make dev            # server at http://localhost:4100/graphql (PORT, default ESIGN_PORT_BASE + 0)
```

`make help` lists all targets. Environment comes from `.env` (see
`.env.example` for every variable, including the fail-closed production
semantics of `DOCUSIGN_HMAC_KEY` and `JWT_SECRET`).

## Architecture in Brief

- **Provider boundary**: all DocuSign-specific code lives in
  `src/providers/docusign/` behind the `ESignProvider` port
  (`src/providers/port.ts`) — including webhook verification/parsing and the
  optional Web Forms capability. New providers = an adapter + a registry entry
  in `src/providers/index.ts` (selected by the package's `providerFromEnv`).
- **Wire contract**: the `ErrorCode` enum in `schema.graphql` (emitted from
  `src/typeDefs.ts` via `make schema-emit`). Client packages codegen from it;
  parity tests + a CI step fail on drift.
- **Domain in the package**: authorization, validation, persistence with an
  audit trail, the restart rule and the webhook state machine are
  `createEnvelopeService` from `@blinkbitcoin/esign-node`, composed in
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

The service ships as a container (`examples/full-service-demo/Dockerfile`, built from the repo
root so the workspace lockfile and `packages/esign-node` are inputs):

```sh
make docker-build                     # → esign-api (node 24 alpine, production deps only)
make docker-smoke                     # boots it with the mock provider, checks /health
docker run --rm --env-file examples/full-service-demo/.env esign-api node dist/migrate.js   # once per database
docker run --rm -p 4100:4100 --env-file examples/full-service-demo/.env esign-api      # serve
```

CI builds and smokes the same image on every branch (E2E / Docker) and
publishes it to GHCR next to the npm packages, under the same version and
dist-tag: `ghcr.io/blinkbitcoin/esign-api:<version>`, `:latest` for a
release, `:next` for every green push to `main` ([releasing.md](../../docs/releasing.md)).
Deploying is then a pull instead of a build:

```sh
docker pull ghcr.io/blinkbitcoin/esign-api:latest
docker run --rm -p 4100:4100 --env-file .env ghcr.io/blinkbitcoin/esign-api:latest
```

Configuration is the same `.env` as local (`.env.example`; the live DocuSign
layout with dummy values is `.env.docusign.example`); with
`ESIGN_PROVIDER=docusign` the JWT credentials and `DOCUSIGN_HMAC_KEY` are
required at boot (fail-closed). The image runs as the unprivileged `node`
user, exposes `4100` (`PORT` overrides) and carries a `/health` healthcheck.
Hosts that would rather not run a service import `@blinkbitcoin/esign-node`
instead (one function call, a Fetch handler, or the Express router).

## Key Paths

| Path | Purpose |
|------|---------|
| `src/typeDefs.ts` → `schema.graphql` | GraphQL SDL → emitted schema artifact |
| `src/schema.ts` | Resolvers |
| `src/providers/port.ts` | `ESignProvider` interface (the provider boundary) |
| `src/providers/docusign/` / `src/providers/mock.ts` | Provider adapters (registry in `providers/index.ts`) |
| `src/services.ts` / `src/store.ts` | Domain composition (`createEnvelopeService`) / the package's Knex<br>`EnvelopeStore` over `src/db.ts` |
| `src/app.ts` | Mounts the package's Express router (`/health`, signing pages,<br>`/webform/instance`, `/webhook/esign`) with this service's auth, CORS and<br>rate limits |
| `src/auth.ts` | HS256 JWT verification, dev/prod split |
| `src/migrate.ts` | Applies the package's migrations (`@blinkbitcoin/esign-node/knex`) |
| `tests/` / `tests/e2e/` | Unit (mocked DB) / E2E (real DB) |

Full documentation: [architecture](../../docs/architecture/backend.md) ·
[API contracts](../../docs/architecture/api-contracts.md) ·
[data models](../../docs/architecture/data-models.md) ·
[real-DocuSign setup](../../docs/integration/docusign-proxy.md)
