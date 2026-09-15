# `@blinkbitcoin/esign-service` — one deployable, mint and envelopes

**For whoever deploys and operates a backend.** If instead you own a Node API
and want it to mint in-process, that is the other tier,
[`@blinkbitcoin/esign-node`](../esign-node/README.md).

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
| mint | `POST /webform/instance` (or `POST /envelope/instance`<br>under `ESIGN_MINT_MODE=envelope`), `GET /signing/return`,<br>`GET /health` | always |
| envelopes | `POST /webhook/esign`, `/graphql`, the Knex store<br>and its migrations | `DATABASE_URL` |

Without `DATABASE_URL` the envelope routes are absent (404), no `pg`
connection is opened and no `DOCUSIGN_HMAC_KEY` is required. `GET /health`
answers `{ status, capabilities, mint, timestamp }` (`mint` is `webform` or
`envelope`), so a deployment says what it is serving. The boot guard lists
every misconfiguration at once — and the capabilities that were on — and
refuses to start.

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
| NixOS | copy `deploy/nix/configuration.nix` into the host<br>config, write the environment file it names, then<br>`nixos-rebuild switch` (the container runs under<br>`virtualisation.oci-containers`) | mint;<br>+ envelopes |
| Cloud Run<br>Fly, Render<br>Railway | the same image, the platform's env UI, port 4100 | mint;<br>+ envelopes |
| Lambda | the same image behind the [AWS Lambda Web<br>Adapter](https://github.com/awslabs/aws-lambda-web-adapter)<br>(`PORT=4100`, no code) | mint;<br>+ envelopes |
| Vercel | `npm i @blinkbitcoin/esign-service`, copy<br>`deploy/vercel/` (a two-line route + `vercel.json`),<br>set the env | mint;<br>+ envelopes<br>with pooled<br>Postgres |
| Cloudflare | `npm i @blinkbitcoin/esign-service`, copy<br>`deploy/cloudflare/` (a one-line worker +<br>`wrangler.toml` with `nodejs_compat`), set the env | mint only |

The NixOS row is a NixOS host declaring a container; a host that merely has
Nix installed is the Docker row.

Applying the envelope schema is the same command everywhere:
`node dist/node.js migrate` (`npx esign-service migrate` from the package).
Workers have no Postgres driver, so the boot guard refuses `DATABASE_URL`
there with a message that says which target to use instead.

Taking a deployment live on a production DocuSign account - the go-live
steps, the production hosts, the private key per platform, the boot guard
and the verification checklist - is the runbook,
[docs/operations/production.md](../../docs/operations/production.md).

### The host's two obligations

1. **Say who the caller is.** Expose a JWKS endpoint (`ESIGN_SESSION_JWKS_URL`) or
   share an HS256 secret (`ESIGN_SESSION_SECRET`). The verified claim
   (`ESIGN_SESSION_USER_CLAIM`, default `sub`) becomes the user id the instance is
   locked to — DocuSign's `clientUserId`. Without either, the bearer token is
   taken as the user id and the boot banner says `session not verified`;
   `ESIGN_STRICT=true` refuses to start instead.
2. **Say what is being signed** — only when the locked terms come from your
   data. Expose `ESIGN_PREFILL_URL`: the service POSTs `{ userId, input }` with the
   caller's bearer token forwarded, and your `{ prefill }` wins over the
   client's values key by key. Client input is intent, never a locked value.
   An envelope mint (`ESIGN_MINT_MODE=envelope`) also sends the client's
   `recipient`, and mints exactly your `{ prefill, recipient }`: nothing of
   the client's reaches the document, since on an envelope the lock travels
   with each value, and your `recipient` is who signs. Without `ESIGN_PREFILL_URL`
   any authenticated caller names the signer.

## Environment

Every name means the same thing on every target; `.env.example` is the full
list with comments.

<!-- BEGIN GENERATED env operator - edit packages/esign-service/src/env/registry.ts -->
| Variable | Why | When | How to obtain |
|---|---|---|---|
| `DATABASE_URL` | Decides whether this deployment orchestrates envelopes at all. Unset,<br>the mint is the whole service and no Postgres connection is opened. | default: unset - the mint alone, on every target | Your Postgres connection string. Apply the schema once with: node<br>dist/node.js migrate |
| `ESIGN_MINT_MODE` | Which of the two mints this deployment answers with. They are different<br>products: a Web Form asks the signer questions first, an envelope puts<br>them straight into the documents. | default: 'webform' | — |
| `ESIGN_PROVIDER` | Which e-signature provider mints. The mock needs no credentials and<br>signs nothing that holds. | default: 'mock' - which the boot banner reports as a demo provider | — |
| `ESIGN_SESSION_JWKS_URL` | Verifies that a caller's bearer token really came from your login<br>provider. Without a session source the service cannot tell one user from<br>another: it takes the token as the user id. | default: unset - see ESIGN_SESSION_SECRET, then the note above | Your identity provider publishes it. Take jwks_uri from its discovery<br>document: curl -s https://<issuer>/.well-known/openid-configuration \|<br>jq -r .jwks_uri Auth0, Okta, Cognito, Keycloak and Firebase all have<br>one. If your own backend issues the tokens, use ESIGN_SESSION_SECRET<br>instead - it is an equal, not a fallback. Confirm it with: node<br>dist/node.js check-session "$TOKEN" |
| `ESIGN_SESSION_SECRET` | The same verification, for a backend that issues its own tokens and<br>signs them with a shared secret. | default: unset | The secret your own backend signs session tokens with - the same value,<br>not a new one. Prefer ESIGN_SESSION_JWKS_URL when you have an identity<br>provider: this service then holds no signing material and cannot mint<br>tokens even if it is compromised. |
| `ESIGN_SESSION_ISSUER` | Pins which issuer a token may come from. Without it any token your key<br>material verifies is accepted, whoever issued it. | default: unset - the issuer is not checked | The iss claim of a real token, copied exactly: echo "$TOKEN" \| cut -d.<br>-f2 \| base64 -d \| jq -r .iss Trailing slashes count. check-session<br>names both sides when they differ. |
| `ESIGN_SESSION_AUDIENCE` | Pins which audience a token was minted for, so a token issued for<br>another service of yours is not accepted here. | default: unset - the audience is not checked | The aud claim of a real token: echo "$TOKEN" \| cut -d. -f2 \| base64 -d<br>\| jq -r .aud |
| `ESIGN_SESSION_USER_CLAIM` | Which claim carries your user id. DocuSign sees this value as<br>clientUserId, so it is what ties a signature to a person. | default: 'sub' | Look at a real token and pick the claim holding your user id: echo<br>"$TOKEN" \| cut -d. -f2 \| base64 -d \| jq |
| `ESIGN_PREFILL_URL` | Decides who computes the values a signer cannot change. Unset, the<br>client's own prefill is minted as sent - which is fine for a fixed<br>consent form and wrong for anything whose fields carry the deal. | default: unset - the client's prefill is minted as sent | An endpoint on your own backend that you write. It receives { userId,<br>input }        (an envelope mint also sends recipient) and answers {<br>prefill: { ... } }     (and, for an envelope, an optional recipient)<br>Confirm it answers correctly with: node dist/node.js check-prefill |
| `ESIGN_PREFILL_SECRET` | Lets your prefill endpoint tell this service apart from anything else<br>that finds the URL. | default: unset - the header is not sent | Any high-entropy string you also configure on the receiving endpoint:<br>openssl rand -hex 32 |
| `ESIGN_PREFILL_TIMEOUT_MS` | Bounds how long a mint waits on your backend before answering 502. | default: 5000 | — |
| `ESIGN_STRICT` | Turns every line the boot banner reports as unverified into a refusal to<br>start. Off by default because what an unverified session or a<br>client-supplied prefill means depends on your architecture, which this<br>process cannot see. | default: unset - the service reports its posture and starts | — |
| `DOCUSIGN_INTEGRATION_KEY` | Identifies your application to DocuSign. Without the JWT-grant<br>credentials nothing can be minted. | ESIGN_PROVIDER=docusign | DocuSign Admin -> Apps and Keys. The full click path, including the<br>consent step that is easy to miss, is<br>docs/integration/docusign-proxy.md. The integration key is the GUID<br>shown on the app. |
| `DOCUSIGN_ACCOUNT_ID` | Which DocuSign account the envelopes and instances belong to. | ESIGN_PROVIDER=docusign | DocuSign Admin -> Account -> API and Keys: the "API Account ID" GUID,<br>not the account number. |
| `DOCUSIGN_USER_ID` | Whom the service impersonates. Envelopes are sent as this user. | ESIGN_PROVIDER=docusign | DocuSign Admin -> Users -> the service user -> "API Username" (a GUID).<br>That user must have granted consent once. |
| `DOCUSIGN_PRIVATE_KEY` | Proves the service is the integration key it claims to be. The only<br>DocuSign value that is a secret. | ESIGN_PROVIDER=docusign | Generate a keypair, upload the public half on the integration key:<br>openssl genrsa -out esign.pem 2048 && openssl rsa -in esign.pem -pubout<br>Paste the private PEM verbatim. DocuSign Admin -> Apps and Keys. The<br>full click path, including the consent step that is easy to miss, is<br>docs/integration/docusign-proxy.md. Alternatives:<br>DOCUSIGN_PRIVATE_KEY_BASE64 (every target), DOCUSIGN_PRIVATE_KEY_FILE (a<br>container secret mount). |
| `DOCUSIGN_PRIVATE_KEY_BASE64` | The same key where a multi-line environment value is awkward. | instead of DOCUSIGN_PRIVATE_KEY | base64 -i esign.pem |
| `DOCUSIGN_PRIVATE_KEY_FILE` | The same key from a mounted secret, so it never appears in the<br>environment. | instead of DOCUSIGN_PRIVATE_KEY | The path a secret is mounted at, e.g. /run/secrets/docusign.pem.<br>Container-only: a Worker has no filesystem. |
| `DOCUSIGN_WEBFORM_ID` | Which Web Form the mint creates an instance of. | the Web Form mint (ESIGN_MINT_MODE=webform) | DocuSign -> Web Forms -> the form -> its id in the URL. The form must be<br>active. |
| `DOCUSIGN_TEMPLATE_ID` | Which template(s) an envelope is created from. | ESIGN_MINT_MODE=envelope, or envelope orchestration | DocuSign -> Templates -> the template -> its id. `make<br>docusign-template` creates the fixture one and prints its id. |
| `DOCUSIGN_RETURN_URL` | Where DocuSign sends the signer afterwards. It must reach this service's<br>bridge, which is what reports completion back to your app. | ESIGN_PROVIDER=docusign | This deployment's public URL plus /signing/return. It has to be<br>reachable by the signer's browser, not just by the service. |
| `DOCUSIGN_SIGNER_ROLE` | Which template role the signer fills. | default: 'signer' | The role name on the template, as spelled there. |
| `DOCUSIGN_HMAC_KEY` | Proves an inbound webhook really came from DocuSign. Without it anyone<br>who finds the URL can write 'completed' into your envelope records. | default: unset - the banner reports an unverified webhook | DocuSign Admin -> Connect -> your configuration -> Add HMAC key.<br>DocuSign shows the secret once. |
| `DOCUSIGN_BASE_URL` | Which DocuSign environment this is. The default is the demo one, which<br>signs nothing that holds up. | default: the demo host - reported as a sandbox by the boot banner | DocuSign Admin -> API and Keys shows your account's base URI, e.g.<br>https://na4.docusign.net/restapi The region prefix differs per account. |
| `DOCUSIGN_OAUTH_URL` | Where the JWT grant is exchanged. It has to match the environment of the<br>account. | default: the demo host | https://account.docusign.com for production; the default is the demo<br>host. |
| `DOCUSIGN_WEBFORMS_BASE_URL` | Where Web Forms instances are minted. Same environment rule again. | default: the demo host | https://apps.docusign.com/api/webforms/v1.1 for production; the default<br>is the demo host. |
| `PORT` | Which port the Node target listens on. A function target is told by its<br>platform. | default: ESIGN_PORT_BASE (4100) | — |
| `ESIGN_TRUST_PROXY` | Whether x-forwarded-for may be believed. It is a caller-controlled<br>header, so believing it without a proxy in front lets anyone spoof their<br>address past the rate limits. | default: unset - x-forwarded-for is ignored | Set it to true only when something you control terminates connections in<br>front of this service. |
| `ESIGN_CORS_ALLOWED_ORIGINS` | Which browser origins may call the mint and the GraphQL API. | default: unset - same-origin only | The origins of your own web app, e.g. https://app.example.com. |
| `ESIGN_RATE_LIMIT_WEBFORM_PER_MIN` | Caps mints per client per minute. Each one costs a real DocuSign<br>instance. | default: 60 | — |
| `ESIGN_RATE_LIMIT_ENVELOPE_PER_MIN` | The same cap for the envelope mint. | default: 60 | — |
| `ESIGN_RATE_LIMIT_WEBHOOK_PER_MIN` | Caps inbound webhooks, which arrive unauthenticated until the signature<br>is checked. | default: 120 | — |
| `ESIGN_RATE_LIMIT_GRAPHQL_PER_MIN` | Caps GraphQL requests per client. | default: 100 | — |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | Turns tracing on. Off unless set, so no deployment ships spans it did<br>not ask for. | default: unset - tracing off | Your collector's OTLP endpoint, e.g. http://localhost:4318. Any OTLP<br>backend works. |
| `OTEL_SERVICE_NAME` | What this service is called in traces. | default: 'esign-service' | — |
<!-- END GENERATED -->

## Quick Start

```sh
# From repo root, once per machine:
direnv allow . && direnv allow packages/esign-service   # env + nix dev shell

# From this directory:
make db-up          # this worktree's dev Postgres (docker, ESIGN_DEV_DB_PORT = base + 13, default 4113)
make migrate        # the package's migrations (src/migrate.ts)
make dev            # service at http://localhost:4100 (PORT, default ESIGN_PORT_BASE + 0)
```

`make help` lists all targets.

## Entry points

| Import | What you get |
|---|---|
| `@blinkbitcoin/esign-service` | `createESignApp(env, deps) → { fetch, capabilities, stop }`<br>and the pure pieces (`validateConfig`, `sessionVerifierFromEnv`,<br>`prefillConfigFromEnv`) |
| `.../node` | `startServer(env) → { url, stop }` over `@hono/node-server`,<br>with the rate limits and the SIGTERM drain |
| `.../vercel` | `export { GET, POST, OPTIONS }` for a route handler |
| `.../cloudflare` | `export default { fetch(request, env) }` for a Worker |
| `npx esign-service` | The process entry point (`esign-service migrate` applies<br>the schema) |

## Architecture in Brief

- **One Fetch core**: `src/app.ts` routes from the capability set. The mint
  half is the package's `createHostedFormApp` (`createEnvelopeApp` under
  `ESIGN_MINT_MODE=envelope`); the envelope half
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
| `src/terms.ts` | The `ESIGN_PREFILL_URL` callback and its merge rule |
| `src/envelopes.ts` | The envelope capability: Fetch webhook + GraphQL<br>(Node-only; reached through the loader an entry passes) |
| `src/proxy.ts` | `ESIGN_TRUST_PROXY`: who may be believed about the client |
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
