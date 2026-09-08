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

The esign service (`apps/api`) is this package plus Express, Apollo and a
Postgres store; a host that already has a backend imports the package
instead of running that service.

## Why a server call at all

DocuSign populates a **read-only** Web Form field only from a
`createInstance` `formValues` payload (or a builder default). That call needs
the integration key's private key, and a locked value is only meaningful when
minted by a party the signer does not control. So the mint runs server-side;
everything else about Web Forms (form UI, validation, document, signing) does
not. Details: [docs/integration/webforms.md](../../docs/integration/webforms.md).

## Use

```ts
import { createWebFormInstance, docuSignConfigFromEnv } from '@blinkbitcoin/esign-server';

// Once, at startup: DOCUSIGN_* env → config (one token cache per config object)
const docusign = docuSignConfigFromEnv();

// Per request, for the authenticated user, with the values you computed
const { url } = await createWebFormInstance({
  config: docusign,
  userId: session.userId,                  // becomes clientUserId
  prefill: {                                // field API reference names → values
    number_of_units: 1000,                  // read-only in the builder → shown locked
    settlement_amount_btc: '0.01268231',    // text field (Number fields take 2 decimals)
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
| `createDocuSignClient(config, { fetch? })` | The client: `createEnvelopeFromTemplate`, `getEmbeddedSigningUrl`, `fetchEnvelopeStatus`, `createWebFormInstanceRequest`, `getAccessToken`, `clearTokenCache` |
| `docuSignConfigFromEnv(env?)`, `DOCUSIGN_ENV`, `assertDocuSignConfig` | Configuration and its `DOCUSIGN_*` mapping (demo-environment URLs by default) |
| `parseWebFormPrefill`, `assertWebFormPrefill`, `formatPrefillValue` | The prefill contract (string, number, string[], phone object) |
| `withRetry`, `HttpError`, `isClientError`, `isNotFoundError` | Retry/backoff and error classification |
| `createTokenProvider`, `createJwtAssertion` | The JWT grant on its own |

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

Every failure is an `ESignError` with a `code` (`UNAUTHORIZED`,
`ENVELOPE_NOT_FOUND`, `VALIDATION_ERROR`, `ENVELOPE_CREATION_FAILED`,
`PROVIDER_UNAVAILABLE`, `PERSISTENCE_FAILED`, `SESSION_EXPIRED`) and a
matching `extensions.code`, the wire contract the client packages map to
messages. `createMockProvider` gives the same port without DocuSign for
local runs and tests; `Tracing` and `Logger` are optional seams.

| Store method | Contract |
|---|---|
| `transaction(fn)` | every write through the store `fn` receives commits together or not at all |
| `createEnvelope`, `getEnvelopeById`, `getEnvelopeByIdForUser`, `getEnvelopeByProviderEnvelopeId`, `updateEnvelopeStatus` | envelope rows; the user-scoped read returns `null` for a wrong owner (no info leak); the update throws for an unknown id |
| `appendAuditEntry`, `listAuditEntries` | audit rows, newest first |

## The HTTP surface (`@blinkbitcoin/esign-server/express`)

For a host that already runs Express and wants the esign endpoints without
writing them: a mountable router plus the GraphQL schema. `express` is an
optional peer - only this subpath imports it.

```ts
import { createESignRouter } from '@blinkbitcoin/esign-server/express';
import { createESignGraphQL } from '@blinkbitcoin/esign-server';

app.use(createESignRouter({
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
| `POST /webform/instance` | mint for the authenticated caller (`401`), validated prefill (`400` with the reason), provider failure `502` |
| `POST /webhook/esign` | raw-body signature check (`401`), parse (`400`), `handleWebhookEvent` (`500` = retry, `200 { received: true }`) |
| `GET /signing/return` | the return-URL bridge for real DocuSign (postMessage protocol, nonce CSP) |
| `GET /signing/mock/:id`, `GET /signing/mock-webform/:id` | the mock provider's pages, when `mockPages` is given |

## Configuration

| Variable | Setting | Notes |
|---|---|---|
| `DOCUSIGN_INTEGRATION_KEY`, `DOCUSIGN_USER_ID`, `DOCUSIGN_ACCOUNT_ID`, `DOCUSIGN_PRIVATE_KEY` | JWT grant | consent granted once per integration key |
| `DOCUSIGN_WEBFORM_ID` | Web Forms | the form to mint instances of |
| `DOCUSIGN_TEMPLATE_ID` | envelopes | only for template envelopes |
| `DOCUSIGN_RETURN_URL` | both | default `returnUrl` for instances / signing views |
| `DOCUSIGN_BASE_URL`, `DOCUSIGN_OAUTH_URL`, `DOCUSIGN_WEBFORMS_BASE_URL` | hosts | default to the developer (demo) environment |

## Development (in this monorepo)

```sh
make test        # Jest, 100% coverage enforced
make build       # tsup (ESM + CJS + types)
```
