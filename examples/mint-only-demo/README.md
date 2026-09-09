# examples/mint-only-demo — your API adds one mutation

The smallest server-side footprint that still gives you **locked, server-set
values** in a DocuSign Web Form: an existing GraphQL API (Apollo Server here,
any framework works) adds one mutation whose resolver makes one call into
`@blinkbitcoin/esign-server`. No envelope domain, no store, no webhooks, no
esign service to run - this is the shape the Blink API uses for the invest
flow.

```
app ──(session token)──▶ your API ──investSigningUrl(units)──▶ createWebFormInstance
                                     computes the amounts           ▲ JWT grant, server-held
                                     from its own quote             │
app ◀────────────── { url } ◀────────────────────────────────────────┘
app opens url in <ESignature source={createWebFormsSource({ mint: ... })}>
```

- `src/quote.ts` - the host's own data (a subscription quote) becomes the
  prefill of the form's read-only fields, formatted as strings: locked
  amounts are Text fields on the form (a read-only Number or Date field
  makes DocuSign refuse the submission, and Number fields take at most two
  decimals anyway - [webforms.md](../../docs/integration/webforms.md)).
- `src/mint.ts` - the one package call. `ESIGN_PROVIDER=mock` swaps in the
  mock provider so the mutation runs with no DocuSign account (the URL
  points at the full-service demo's mock Web Forms page).
- `src/schema.ts`, `src/server.ts` - stand-ins for what the host already has:
  its schema and its session handling. The bearer token is taken as the user
  id here; a real host verifies its own session in that spot.

## Run

```sh
cp .env.example .env
make dev                     # http://localhost:4100 (PORT overrides), mock provider
curl -s http://localhost:4100 -H 'content-type: application/json' \
  -H 'authorization: Bearer user-1' \
  -d '{"query":"mutation { investSigningUrl(units: 10) { url } }"}'
```

With `ESIGN_PROVIDER=docusign` and the JWT-grant credentials in `.env`
(`DOCUSIGN_*`, see [docusign-proxy.md](../../docs/integration/docusign-proxy.md)),
the same mutation mints a real instance; the read-only fields of the form
show the computed amounts and cannot be edited
([webforms.md](../../docs/integration/webforms.md)).

## Test

```sh
make test          # Vitest, 100% coverage enforced (make coverage)
```

CI also boots this example with the mock provider and runs the mutation end
to end (`scripts/e2e/server-demos-smoke.sh`, `make e2e-server-demos`).

## The other server shapes

[`full-service-demo`](../full-service-demo/README.md) runs the whole service;
[`serverless-handler-demo`](../serverless-handler-demo/README.md) mounts the
package's Fetch handlers in a route handler or edge function.
