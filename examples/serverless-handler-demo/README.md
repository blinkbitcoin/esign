# examples/serverless-handler-demo — the handlers behind a route

`@blinkbitcoin/esign-node` ships the two esign endpoints as Fetch API
handlers, `Request → Response`, so a serverless route exports them as-is.
This example mounts both: the Web Forms mint (`POST /webform/instance`,
what `createWebFormsSource({ mint })` in the client packages calls) and the
provider webhook (`POST /webhook/esign`, the envelope domain's state machine
over an in-memory store).

```ts
// src/handlers.ts - the whole integration
const provider = providerFromEnv(process.env);              // DocuSign, or the mock
const envelopes = createEnvelopeService({ provider, store: createMemoryEnvelopeStore() });
export const mint = createWebFormInstanceHandler({ provider, authenticate });
export const webhook = createWebhookHandler({ provider, envelopes });
```

| Platform | Mounting |
|---|---|
| Next.js route handler | `app/api/webform/instance/route.ts`: `export const POST = mint;` |
| Vercel function | `export default (req: Request) => mint(req);` |
| Cloudflare Worker | `fetch(request)` routes by path: `/webhook/esign` → `webhook(request)`,<br>anything else → `mint(request)` |
| Plain Node (this example) | `src/node.ts` adapts `IncomingMessage` to a `Request` and back |

`authenticate` is the host's session check - the bearer token is taken as the
user id here; a real host verifies its own token in that spot. The DocuSign
JWT credentials stay in the function's environment. The webhook path needs
`node:crypto`, so the webhook handler runs on Node runtimes; the mint handler
runs anywhere `fetch` does.

## Run

```sh
cp .env.example .env
make dev                     # http://localhost:4105 (PORT overrides; ESIGN_PORT_BASE + 5), mock provider
curl -s -X POST http://localhost:4105/webform/instance \
  -H 'content-type: application/json' -H 'authorization: Bearer user-1' \
  -d '{"prefill":{"number_of_units":"10"}}'
```

With `ESIGN_PROVIDER=docusign`, the JWT-grant credentials and
`DOCUSIGN_HMAC_KEY` in `.env`, the mint returns a real instance URL and the
webhook verifies DocuSign's HMAC signature.

## Test

```sh
make test          # Vitest, 100% coverage enforced (make coverage)
```

CI boots this example with the mock provider and calls both routes
(`scripts/e2e/server-demos-smoke.sh`, `make e2e-server-demos`).

## The other server shapes

[`full-service-demo`](../full-service-demo/README.md) runs the whole service;
[`mint-only-demo`](../mint-only-demo/README.md) adds one mutation to an API
you already have.
