# @blinkbitcoin/esign-server

The server-side half of the e-signature packages, for any Node ≥ 18 backend,
no framework, no peers:

- a **DocuSign client** (JWT grant, envelopes from a template, embedded
  signing views, Web Forms instances) and the **one call a backend needs for
  locked prefill**, `createWebFormInstance`;
- the **envelope domain** behind the proxy mode - `createEnvelopeService`
  over two ports, an `ESignProvider` (DocuSign or the mock) and an
  `EnvelopeStore` you implement on your database (an in-memory one ships) -
  with authorization and ownership, input bounds, atomic persistence with an
  audit trail, the restart rule and the webhook state machine.

The esign service (`examples/full-service-demo`) is this package plus Express, Apollo and a
Postgres store; a host that already has a backend imports the package
instead of running that service.

Three worked hosts live in this repo, one per shape:
[`examples/mint-only-demo`](../../examples/mint-only-demo/README.md) (one
mutation on an existing API), [`examples/serverless-handler-demo`](../../examples/serverless-handler-demo/README.md)
(the Fetch handlers behind a route) and [`examples/full-service-demo`](../../examples/full-service-demo/README.md)
(the whole service, also shipped as the `esign-api` image).

## Why a server call at all

DocuSign populates a **read-only** Web Form field only from a
`createInstance` `formValues` payload (or a builder default). That call needs
the integration key's private key, and a locked value is only meaningful when
minted by a party the signer does not control. So the mint runs server-side;
everything else about Web Forms (form UI, validation, document, signing) does
not. Details: [docs/integration/webforms.md](../../docs/integration/webforms.md);
the end-to-end recipe for a GraphQL API + app, including the builder checklist
and the return-URL bridge route every Web Forms host must serve:
[docs/integration/locked-terms.md](../../docs/integration/locked-terms.md).
Authentication of the caller is the host's own (this package never sees the
session token); the `JWT_SECRET` of this repo's service is not part of it.

## Use

```ts
import { createWebFormInstance, docuSignConfigFromEnv } from '@blinkbitcoin/esign-server';

// Once, at startup: DOCUSIGN_* env → config (one token cache per config object)
const docusign = docuSignConfigFromEnv();

// Per request, for the authenticated user, with the values you computed
const { url } = await createWebFormInstance({
  config: docusign,
  userId: session.userId,                  // becomes clientUserId: stable per signer, <= 100 chars
  prefill: {                                // field API reference names → values
    number_of_units: '1000',                // read-only in the builder → shown locked; locked fields are
    settlement_amount_btc: '0.01268231',    //   Text fields fed strings (never read-only Number/Date)
    country: 'Sweden',                      // editable in the builder → a suggestion
  },
  returnUrl: 'https://api.example.com/signing/return', // optional; where DocuSign sends the signer after signing
});
// Hand `url` (formUrl#instanceToken=…) to the app right away: the token lives ~5 minutes
```

The prefill is validated before any network call (`WebFormPrefillError`
with the reason), missing settings fail fast (`DocuSignConfigError`), and
transient DocuSign failures (5xx, 429, network) are retried with backoff.

Lower-level pieces, for hosts that need them:

| Export | What |
|---|---|
| `createDocuSignClient(config, { fetch? })`, `WebFormsClient` | The client: `createEnvelopeFromTemplate`, `getEmbeddedSigningUrl`,<br>`fetchEnvelopeStatus`, `createWebFormInstanceRequest`, `getAccessToken`,<br>`clearTokenCache`; `createWebFormInstance({ client })` needs only<br>`WebFormsClient` (`config` + `createWebFormInstanceRequest`), so a host's own<br>client fits |
| `docuSignConfigFromEnv(env?)`, `DOCUSIGN_ENV`, `assertDocuSignConfig` | Configuration and its `DOCUSIGN_*` mapping (demo-environment URLs by<br>default) |
| `parseWebFormPrefill`, `assertWebFormPrefill`, `formatPrefillValue` | The prefill contract (string, number, string[], phone object) |
| `withRetry`, `HttpError`, `isClientError`, `isNotFoundError` | Retry/backoff and error classification |
| `createTokenProvider`, `createJwtAssertion` | The JWT grant on its own |
| `bearerToken(header)` | The token of an `Authorization: Bearer …` header, or `null` (missing,<br>another scheme, empty); what it means - a session to verify, a user id<br>in a demo - stays the host's |

## The envelope domain (proxy mode without hosting the service)

```ts
import {
  createEnvelopeService, createDocuSignProvider, docuSignConfigFromEnv,
  createMemoryEnvelopeStore, type EnvelopeStore,
} from '@blinkbitcoin/esign-server';

const provider = createDocuSignProvider({
  config: docuSignConfigFromEnv(),
  webhook: { hmacKey: () => process.env.DOCUSIGN_HMAC_KEY },
});
const store: EnvelopeStore = createMemoryEnvelopeStore(); // or your own, over your database
const envelopes = createEnvelopeService({ provider, store });

// In your API, with the authenticated user:
const { envelopeId, signingUrl } = await envelopes.createEnvelope(userId, { contractType, recipient });
const { signingUrl: again } = await envelopes.getSigningUrl(userId, { envelopeId, recipient }); // restart
const view = await envelopes.getEnvelope(userId, envelopeId);          // never the provider's id
const trail = await envelopes.getAuditLogs(userId, envelopeId);       // newest first, no PII

// In your webhook route, with the RAW body bytes:
if (!provider.verifyWebhook(req.headers, rawBody, req.ip)) return 401;
const event = provider.parseWebhookEvent(rawBody);
if (!event) return 400;
await envelopes.handleWebhookEvent(event); // idempotent; terminal statuses never downgrade
```

`providerFromEnv(env, defaultRegistry(env))` selects the adapter the way the
three example hosts do: `ESIGN_PROVIDER=docusign` or `mock` (the default; an
unknown name warns once and falls back), each entry built lazily so the mock
never reads `DOCUSIGN_*`. A host with its own adapter spreads another entry
into the registry. `hostedFormMint(provider)` is the provider's mint as a
plain function (`undefined` without the capability; `supportsHostedForms`
is the guard), accepting adapters that still implement the deprecated
`createWebFormInstance` name.

Every failure is an `ESignError` with a `code` (`UNAUTHORIZED`,
`ENVELOPE_NOT_FOUND`, `VALIDATION_ERROR`, `ENVELOPE_CREATION_FAILED`,
`PROVIDER_UNAVAILABLE`, `PERSISTENCE_FAILED`, `SESSION_EXPIRED`) and a
matching `extensions.code`, the wire contract the client packages map to
messages. `createMockProvider` gives the same port without DocuSign for
local runs and tests; `Tracing` and `Logger` are optional seams.

| Store method | Contract |
|---|---|
| `transaction(fn)` | every write through the store `fn` receives commits together or not at all |
| `createEnvelope`, `getEnvelopeById`, `getEnvelopeByIdForUser`,<br>`getEnvelopeByProviderEnvelopeId`, `updateEnvelopeStatus` | envelope rows; the user-scoped read returns `null` for a wrong owner (no<br>info leak); the update throws for an unknown id |
| `appendAuditEntry`, `listAuditEntries` | audit rows, newest first |

## The Postgres store (`@blinkbitcoin/esign-server/knex`)

For a host that keeps envelopes in Postgres, the store port and its schema
are already written. The host passes its own Knex instance; `knex` is an
optional peer for the types only, nothing else is imported:

```ts
import { createKnexEnvelopeStore, runESignMigrations } from '@blinkbitcoin/esign-server/knex';

await runESignMigrations(db);                        // once per database (knex.migrate.latest)
const store = createKnexEnvelopeStore(db);           // any Knex instance; { logger } optional
const envelopes = createEnvelopeService({ provider, store });
```

The migrations are a programmatic Knex migration source
(`createESignMigrationSource()`, `ESIGN_MIGRATIONS`), so no migration
files, knexfile or TypeScript loader are needed at runtime; `rollback` and
`status` take the same `migrationSource`. Two tables, `Envelope` and
`AuditLog` ([data-models](../../docs/architecture/data-models.md)).

## As a serverless / route handler (no framework)

The two endpoints exist as Fetch API `Request → Response` handlers, the
shape Vercel and Netlify functions, Next.js route handlers and Lambda
adapters mount directly. Keep the config at module scope so a warm instance
reuses its access token; a cold start costs one token exchange.

```ts
import { createWebFormInstanceHandler, docuSignConfigFromEnv } from '@blinkbitcoin/esign-server';

const docusign = docuSignConfigFromEnv();

// e.g. app/api/webform/instance/route.ts (Next.js) or api/webform-instance.ts (Vercel)
export const POST = createWebFormInstanceHandler({
  config: docusign,                                   // or { provider } for the full provider
  authenticate: async request => verifySession(request.headers.get('authorization')), // user id or null
});
```

`createWebhookHandler({ provider, envelopes, clientIp? })` is the webhook
counterpart. The mint handler's target is a `{ provider }`, a `{ mint }`
function (`hostedFormMint(provider)`, `mintFromDocuSign({ config })`, or
your own) or, as above, DocuSign's config/client directly;
`createHostedFormInstanceHandler` is the provider-neutral spelling and takes
a `parsePrefill` for a provider with another prefill contract (the default
stays DocuSign's, so the `400` reasons do not change). Both answer the same status codes as the Express router
(`401`, `400` with the reason, `502` / `500`), because both call the same
`mintWebFormInstanceHttp` / `processWebhookHttp` decision functions. Runs
on Node runtimes (needs `node:crypto`); not on edge runtimes.

The return-URL bridge every Web Forms host serves is a `Response` too:

```ts
import { renderSigningReturnBridge, signingPageResponse } from '@blinkbitcoin/esign-server';

// e.g. app/signing/return/route.ts (Next.js)
export const GET = (request: Request) => {
  const event = new URL(request.url).searchParams.get('event') ?? undefined;
  return signingPageResponse(nonce => renderSigningReturnBridge(event, nonce));
};
```

`signingPageResponse(render)` sends the page as `text/html` under the
package's signing-page CSP (`signingPageCsp(nonce)`: `default-src 'none'`,
inline script and style allowed by a fresh `signingPageNonce()` only,
`frame-ancestors *` so the app's WebView/iframe may embed it). An Express
host that writes the route itself sets the same header from the same two
functions ([locked-terms.md](../../docs/integration/locked-terms.md#2-the-backend-side-node-a-graphql-mutation-or-a-rest-endpoint)).

## The HTTP surface (`@blinkbitcoin/esign-server/express`)

For a host that already runs Express and wants the esign endpoints without
writing them: a mountable router plus the GraphQL schema. `express` is an
optional peer - only this subpath imports it.

```ts
import { createESignRouter } from '@blinkbitcoin/esign-server/express';
import { createESignGraphQL } from '@blinkbitcoin/esign-server';

app.use(createESignRouter({ // mounts DocuSign's pages via mountDocuSignPages (also exported here)
  envelopes, provider,
  authenticate: req => yourAuth(req.headers.authorization), // user id or null
  mockPages: provider === mock ? { getWebFormPrefill: mock.getWebFormPrefill } : undefined,
  middleware: { cors, webform: [rateLimit, cors], webhook: [rateLimit] }, // your policy
}));
const { typeDefs, resolvers } = createESignGraphQL({ envelopes }); // → your Apollo/GraphQL server, context { userId }
```

| Route | What |
|---|---|
| `GET /health` | `{ status, timestamp }` |
| `POST /webform/instance` | mint for the authenticated caller (`401`), validated prefill (`400` with the<br>reason), provider failure `502` |
| `POST /webhook/esign` | raw-body signature check (`401`), parse (`400`), `handleWebhookEvent` (`500` =<br>retry, `200 { received: true }`) |
| `GET /signing/return` | the return-URL bridge for real DocuSign (postMessage protocol, nonce<br>CSP) |
| `GET /signing/mock/:id`, `GET /signing/mock-webform/:id` | the mock provider's pages, when `mockPages` is given |

The signing pages go out under `signingPageCsp(nonce)` with a
`signingPageNonce()` per response - the same CSP `signingPageResponse` gives
a framework-neutral host.

## The DocuSign adapter (`@blinkbitcoin/esign-server/docusign`)

Everything DocuSign-specific is also on its own entry, peer-free: the
client, `docuSignConfigFromEnv` and the `DOCUSIGN_*` mapping,
`createDocuSignProvider`, `createWebFormInstance`, the prefill contract
(`parseWebFormPrefill`, `WebFormPrefill`), the return-URL bridge
(`renderSigningReturnBridge`, `mapDocuSignReturnEvent`), the mock Web Forms
page and `mintFromDocuSign`. The root entry keeps re-exporting all of it;
the subpath is the canonical import for DocuSign names going forward
(`mountDocuSignPages` stays on `./express`, which needs the peer).

```ts
import { createDocuSignProvider, docuSignConfigFromEnv } from '@blinkbitcoin/esign-server/docusign';
```

| Entry | What | Peer |
|---|---|---|
| `@blinkbitcoin/esign-server` | everything: domain, ports, registry, handlers, pages, DocuSign + mock<br>adapters | none |
| `@blinkbitcoin/esign-server/docusign` | the DocuSign adapter | none |
| `@blinkbitcoin/esign-server/express` | `createESignRouter`, `mountDocuSignPages` | `express` |
| `@blinkbitcoin/esign-server/knex` | the Postgres store + migrations | `knex` (types only) |

## Configuration

| Variable | Setting | Notes |
|---|---|---|
| `DOCUSIGN_INTEGRATION_KEY`, `DOCUSIGN_USER_ID`, `DOCUSIGN_ACCOUNT_ID`,<br>`DOCUSIGN_PRIVATE_KEY` | JWT grant | consent granted once per integration key |
| `DOCUSIGN_WEBFORM_ID` | Web Forms | the form to mint instances of |
| `DOCUSIGN_TEMPLATE_ID` | envelopes | only for template envelopes |
| `DOCUSIGN_RETURN_URL` | both | default `returnUrl` for instances / signing views |
| `DOCUSIGN_BASE_URL`, `DOCUSIGN_OAUTH_URL`, `DOCUSIGN_WEBFORMS_BASE_URL` | hosts | default to the developer (demo) environment |

## Development (in this monorepo)

```sh
make test        # Jest, 100% coverage enforced
make build       # tsup (ESM + CJS + types)
```

The reference host is `examples/full-service-demo` (Knex store, Express + Apollo, the same
router mounted); it also ships as a container image,
`ghcr.io/blinkbitcoin/esign-api`, for hosts that would rather run the
service than import the package ([examples/full-service-demo/README.md](../../examples/full-service-demo/README.md#deploy)).
