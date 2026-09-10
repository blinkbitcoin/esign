# `@blinkbitcoin/esign-service` — one deployable, mint and envelopes

The whole e-signature service as a Fetch-native app composed from
`@blinkbitcoin/esign-node`: the hosted-form mint, the signing pages, the
envelope domain, the Postgres store, the provider webhook and the GraphQL
API — with this service's session verification, locked terms, CORS, rate
limits, boot guard and telemetry around them.

It is the one of three server shapes on `esign-node` that ships as a
standalone deployable (see [`examples/`](../../examples/README.md) for the
two in-process shapes) and the backend the two client demos and every E2E
suite run against: `npm i @blinkbitcoin/esign-service`, or run the
`esign-service` image straight from GHCR.

## Capabilities, decided by the environment

| Capability | Routes | Turned on by |
|---|---|---|
| mint | `POST /webform/instance`, `GET /signing/return`,<br>`GET /health` | always |
| envelopes | `POST /webhook/esign`, `/graphql`, the Knex store<br>and its migrations | `DATABASE_URL` |

Without `DATABASE_URL` the envelope routes are absent (404), no `pg`
connection is opened and no `DOCUSIGN_HMAC_KEY` is required. `GET /health`
answers `{ status, capabilities, timestamp }`, so a deployment says what it
is serving. The boot guard lists every misconfiguration at once — and the
capabilities that were on — and refuses to start.

## Deploy

Every row is the same image or the same package, the same environment
contract and the same `/health`. Templates for each live in
[`deploy/`](deploy/) and ship in the tarball; their only inputs are
environment variables.

| Target | What you deploy | Capabilities |
|---|---|---|
| Docker | `docker run -p 4100:4100 --env-file .env`<br>`ghcr.io/blinkbitcoin/esign-service:latest`<br>(the image defaults to `ESIGN_ENV=production`) | mint;<br>+ envelopes<br>with a database |
| Compose | `cp deploy/docker-compose.yml .` then<br>`docker compose up -d` (`--profile postgres` adds<br>a database, `--profile migrate` applies its schema) | mint;<br>+ envelopes |
| Kubernetes | fill `deploy/k8s/secret.yaml` (the environment) and<br>`secret-docusign-pem.yaml` (the mounted key), then<br>`kubectl apply -k deploy/k8s` (Deployment, Service,<br>migrate Job, probes on `/health`) | mint;<br>+ envelopes |
| Cloud Run<br>Fly, Render<br>Railway | the same image, the platform's env UI, port 4100 | mint;<br>+ envelopes |
| Lambda | the same image behind the [AWS Lambda Web<br>Adapter](https://github.com/awslabs/aws-lambda-web-adapter)<br>(`PORT=4100`, no code) | mint;<br>+ envelopes |
| Vercel | `npm i @blinkbitcoin/esign-service`, copy<br>`deploy/vercel/` (a two-line route + `vercel.json`),<br>set the env | mint;<br>+ envelopes<br>with pooled<br>Postgres |
| Cloudflare | `npm i @blinkbitcoin/esign-service`, copy<br>`deploy/cloudflare/` (a one-line worker +<br>`wrangler.toml` with `nodejs_compat`), set the env | mint only |

Applying the envelope schema is the same command everywhere:
`node dist/node.js migrate` (`npx esign-service migrate` from the package).
Workers have no Postgres driver, so the boot guard refuses `DATABASE_URL`
there with a message that says which target to use instead.

### The host's two obligations

1. **Say who the caller is.** Expose a JWKS endpoint (`SESSION_JWKS_URL`) or
   share an HS256 secret (`SESSION_HS256_SECRET`). The verified claim
   (`SESSION_USER_CLAIM`, default `sub`) becomes the user id the instance is
   locked to — DocuSign's `clientUserId`. Without either, the service
   refuses to boot unless `ALLOW_INSECURE_DEV=true`.
2. **Say what is being signed** — only when the locked terms come from your
   data. Expose `TERMS_URL`: the service POSTs `{ userId, input }` with the
   caller's bearer token forwarded, and your `{ prefill }` wins over the
   client's values key by key. Client input is intent, never a locked value.

## Environment

Every name means the same thing on every target; `.env.example` is the full
list with comments.

| Variable | Meaning |
|---|---|
| `DATABASE_URL` | Postgres; its presence turns envelope orchestration on |
| `SESSION_JWKS_URL` | Remote key set (RS/ES) for session verification |
| `SESSION_ISSUER`,<br>`SESSION_AUDIENCE` | Enforced when set |
| `SESSION_USER_CLAIM` | The claim carrying the user id (default `sub`) |
| `SESSION_HS256_SECRET` | Shared secret instead of a key set (`JWT_SECRET` is<br>an accepted alias) |
| `TERMS_URL` | Where the host computes the prefill actually minted |
| `TERMS_SHARED_SECRET` | Sent as `x-esign-terms-secret` when set |
| `TERMS_TIMEOUT_MS` | Default 5000; a timeout or non-2xx answers `502` |
| `TERMS_ALLOW_INSECURE` | `true` to allow a plaintext `TERMS_URL` in production.<br>The callback carries the caller's session token and<br>`TERMS_SHARED_SECRET`, so `http:` is refused unless the<br>host is private (loopback, `*.svc`,<br>`*.svc.cluster.local`, `*.internal`) |
| `ESIGN_ALLOW_CLIENT_PREFILL` | `true` to mint the client's own prefill in production |
| `ESIGN_PROVIDER` | `mock` (default) or `docusign` |
| `MOCK_PAGES` | `false` turns the mock provider's signing pages off |
| `DOCUSIGN_*` | Provider settings (`.env.docusign.example`) |
| `ESIGN_ENV` | `production` refuses demo settings and disables<br>introspection (`ESIGN_ALLOW_DEMO=true` overrides).<br>**The image sets it**, so a container refuses the mock<br>provider and demo DocuSign hosts unless you opt out |
| `CORS_ALLOWED_ORIGINS` | Browser origins allowed to call the API |
| `ALLOW_INSECURE_DEV` | The explicit opt-in to no verification (never in<br>production) |
| `OTEL_*` | Standard OpenTelemetry variables; tracing is off<br>unless set |
| `TRUST_PROXY` | `true` when a proxy you trust rewrites<br>`x-forwarded-for`: it then names the client for the<br>rate limits and for the webhook's security log.<br>Without it the header is ignored everywhere |
| `PORT`,<br>`RATE_LIMIT_*_PER_MIN`,<br>`DOCUSIGN_PRIVATE_KEY_FILE` | **Container only.** A function relies on its<br>platform for the port and the limits;<br>`DOCUSIGN_PRIVATE_KEY_BASE64` works everywhere |

## Quick Start

```sh
# From repo root, once per machine:
direnv allow . && direnv allow packages/esign-service   # env + nix dev shell

# From this directory:
make db-up          # dev Postgres (docker, port 5432)
make migrate        # the package's migrations (src/migrate.ts)
make dev            # service at http://localhost:4100 (PORT, default ESIGN_PORT_BASE + 0)
```

`make help` lists all targets.

## Entry points

| Import | What you get |
|---|---|
| `@blinkbitcoin/esign-service` | `createESignApp(env, deps) → { fetch, capabilities, stop }`<br>and the pure pieces (`validateConfig`, `sessionVerifierFromEnv`,<br>`termsConfigFromEnv`) |
| `.../node` | `startServer(env) → { url, stop }` over `@hono/node-server`,<br>with the rate limits and the SIGTERM drain |
| `.../vercel` | `export { GET, POST, OPTIONS }` for a route handler |
| `.../cloudflare` | `export default { fetch(request, env) }` for a Worker |
| `npx esign-service` | The process entry point (`esign-service migrate` applies<br>the schema) |

## Architecture in Brief

- **One Fetch core**: `src/app.ts` routes from the capability set. The mint
  half is the package's `createHostedFormApp`; the envelope half
  (`src/envelopes.ts`: the Fetch webhook handler and Apollo over
  `executeHTTPGraphQLRequest`) is behind a dynamic import, so nothing pulls
  Apollo or `pg` into a mint-only deployment — a guard test walks the
  Cloudflare entry's static import graph.
- **Provider boundary**: all DocuSign-specific code lives in
  `src/providers/docusign/` behind the `ESignProvider` port
  (`src/providers/port.ts`). New providers = an adapter + a registry entry
  in `src/providers/index.ts` (selected by the package's `providerFromEnv`).
- **Wire contract**: the `ErrorCode` enum in `schema.graphql` (emitted from
  `src/typeDefs.ts` via `make schema-emit`). Client packages codegen from
  it; parity tests + a CI step fail on drift.
- **Domain in the package**: authorization, validation, persistence with an
  audit trail, the restart rule and the webhook state machine are
  `createEnvelopeService` from `@blinkbitcoin/esign-node`, composed in
  `src/services.ts`; resolvers never query inline.
- **ID protection**: clients only ever see internal UUIDs; provider envelope
  IDs never leave this service.
- **Fail-closed at boot**: `validateConfig` (`src/config.ts`) is pure - env
  in, problems out - so a container refuses to start and a function fails at
  first import, on the same rules. The image defaults to
  `ESIGN_ENV=production`, so the strict posture is what you get unless you
  opt out.
- **One provider per app**: `selectProvider(env)` builds the adapters an app
  mints, verifies webhooks and resolves GraphQL with. There is no module-level
  singleton, so a Worker's bindings decide what it mints with and the
  resolvers can never run on a different adapter than the mint.
- **Observability**: opt-in OpenTelemetry tracing via standard `OTEL_*` env
  vars (`src/instrumentation.ts`) - http/graphql/pg/undici spans to any OTLP
  backend, or `OTEL_TRACES_EXPORTER=console` locally.

## Testing

```sh
make test           # unit tests (Vitest, DB mocked) - 100% coverage (enforced)
make migrate-test   # migrations against the tmpfs test DB (start it first:
                    #   docker compose -f ../../docker-compose.test.yml up -d --wait)
make e2e            # E2E tests against real Postgres
```

From the repo root, `make docker-build && make docker-smoke` boots the image
in both capability modes, and `make deploy-check` validates the deploy
templates: `docker compose config` always, the Cloudflare template through a
`wrangler deploy --dry-run` (wrangler from `npx` when it is not installed;
needs `npm run build` first; run on a throwaway copy, so the shipped template
never gets a `.wrangler/`), and `kubeconform` when it is installed. CI runs
it in E2E / Build Packages, where the dist already exists.

## Key Paths

| Path | Purpose |
|------|---------|
| `src/app.ts` | The Fetch core: capabilities → routes, plus auth, CORS<br>and the security headers |
| `src/capabilities.ts` | What the environment turns on |
| `src/config.ts` | The boot guard (`validateConfig`, pure) |
| `src/session.ts` | Session verification (JWKS or HS256, via `jose`) |
| `src/terms.ts` | The `TERMS_URL` callback and its merge rule |
| `src/envelopes.ts` | The envelope capability: Fetch webhook + GraphQL<br>(Node-only; reached through the loader an entry passes) |
| `src/proxy.ts` | `TRUST_PROXY`: who may be believed about the client |
| `src/server.ts` / `src/node.ts` | `startServer` (rate limits, drain) / the process entry point |
| `src/vercel.ts` / `src/cloudflare.ts` | The two function targets |
| `src/typeDefs.ts` → `schema.graphql` | GraphQL SDL → emitted schema artifact |
| `src/schema.ts` | Resolvers |
| `src/providers/port.ts` | `ESignProvider` interface (the provider boundary) |
| `src/providers/docusign/` / `src/providers/mock.ts` | Provider adapters (registry in `providers/index.ts`) |
| `src/services.ts` / `src/store.ts` | Domain composition (`createEnvelopeService`) / the package's Knex<br>`EnvelopeStore` over `src/db.ts` |
| `src/migrate.ts` | Applies the package's migrations (`@blinkbitcoin/esign-node/knex`) |
| `deploy/` | Deploy templates, one per target (shipped in the tarball) |
| `tests/` / `tests/e2e/` | Unit (mocked DB) / E2E (real DB) |

Full documentation: [architecture](../../docs/architecture/backend.md) ·
[API contracts](../../docs/architecture/api-contracts.md) ·
[data models](../../docs/architecture/data-models.md) ·
[real-DocuSign setup](../../docs/integration/docusign-proxy.md)
