# examples/mint-only-demo — your API adds one mutation

The smallest server-side footprint that still gives you **locked, server-set
values** in a DocuSign Web Form: an existing GraphQL API (Apollo Server here,
any framework works) adds one mutation whose resolver makes one call into
`@blinkbitcoin/esign-node`. No envelope domain, no store, no webhooks, no
esign service to run - the shape for a host that already has an API and
only needs locked terms (the example's domain is a subscription quote).

```
app ──(session token)──▶ your API ──investSigningUrl(units)──▶ createWebFormInstance
                                     computes the amounts           ▲ JWT grant, server-held
                                     from its own quote             │
app ◀────────────── { url } ◀────────────────────────────────────────┘
app ──opens url in a WebView──▶ DocuSign form (locked terms) → signed envelope
app ◀──postMessage── GET /signing/return (this API's bridge page) ◀── DocuSign redirect
app opens url in <ESignature source={createWebFormsSource({ mint: ... })}>
```

- `src/quote.ts` - the host's own data (a subscription quote) becomes the
  prefill of the form's read-only fields, formatted as strings: locked
  amounts are Text fields on the form (a read-only Number or Date field
  makes DocuSign refuse the submission, and Number fields take at most two
  decimals anyway - [webforms.md](../../docs/integration/webforms.md)).
- `src/mint.ts` - `hostedFormMint(hostedFormProviderFromEnv(env))`, the
  package's own preset: `ESIGN_PROVIDER=mock` swaps in the mock provider so
  the mutation runs with no DocuSign account (the URL points at the
  full-service demo's mock Web Forms page); with `docusign` it requires the
  JWT grant plus `DOCUSIGN_WEBFORM_ID`/`DOCUSIGN_RETURN_URL` at boot, not on
  the first mutation.
- `src/schema.ts`, `src/server.ts` - stand-ins for what the host already has:
  its schema and its session handling. The bearer token is taken as the user
  id here; a real host verifies its own session in that spot. Two spellings
  of the same mint are shown side by side (a real host picks one):
  - the GraphQL mutation above, resolved against `quoteFor`/`prefillFromQuote`
    directly;
  - the REST preset, `createHostedFormRouter` from
    `@blinkbitcoin/esign-node/express`, mounted at `app.use(...)` -
    `POST /webform/instance`, `GET /health`, and the one extra route a Web
    Forms host needs, the return-URL bridge (`GET /signing/return`): DocuSign
    sends the signer there after the form's envelope is signed, and the page
    posts the outcome to the app's WebView. `DOCUSIGN_RETURN_URL` points at
    it. Its `prefill` hook computes the same locked amounts from the
    caller's own `number_of_units` (`unitsFrom` in `src/quote.ts` - intent,
    never trusted for the read-only fields).
- `src/index.ts` - `SIGTERM`/`SIGINT` stop the server and exit, so a
  container orchestrator's shutdown is clean.
- The app side of this shape (the source that calls the mutation, what
  `onComplete` delivers): [locked-terms.md](../../docs/integration/locked-terms.md).

## Run

```sh
cp .env.example .env
make dev                     # http://localhost:4104 (PORT overrides; ESIGN_PORT_BASE + 4), mock provider
curl -s http://localhost:4104 -H 'content-type: application/json' \
  -H 'authorization: Bearer user-1' \
  -d '{"query":"mutation { investSigningUrl(units: 10) { url } }"}'
```

With `ESIGN_PROVIDER=docusign` and the JWT-grant credentials in `.env`
(`DOCUSIGN_*`, see [docusign-proxy.md](../../docs/integration/docusign-proxy.md)),
the same mutation mints a real instance; the read-only fields of the form
show the computed amounts and cannot be edited, and the form can be
submitted and signed ([webforms.md](../../docs/integration/webforms.md);
`make e2e-live` mints through this example against real DocuSign).

## Test

```sh
make test          # Vitest, 100% coverage enforced (make coverage)
```

CI also boots this example with the mock provider and calls both spellings
of the mint - the GraphQL mutation and `POST /webform/instance` - plus
`GET /health` (`scripts/e2e/server-demos-smoke.sh`, `make e2e-server-demos`).

## Build and run as a container

This demo also ships a `Dockerfile`, to prove the shape actually deploys
(not to publish it - see [Deploy](../../packages/esign-service/README.md#deploy)
for the package host apps actually run in production):

```sh
make docker-build-mint-only    # → esign-mint-only-demo (node 24 alpine, production deps only)
make docker-smoke-mint-only    # boots it with the mock provider, checks /health
docker run --rm -p 4104:4104 -e ESIGN_PROVIDER=mock esign-mint-only-demo
```

CI builds and smokes the same image on every branch (E2E / Docker); it is
never uploaded as an artifact or published - a real deployment installs
`@blinkbitcoin/esign-service` (or, in this shape, `@blinkbitcoin/esign-node`
straight into an existing API) rather than running this example's image.

## Two in-process examples and the service

[`serverless-handler-demo`](../serverless-handler-demo/README.md) mounts the
package's Fetch handlers in a route handler or edge function;
[`@blinkbitcoin/esign-service`](../../packages/esign-service/README.md) runs
the whole service.
