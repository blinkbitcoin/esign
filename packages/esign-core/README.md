# @blinkbitcoin/esign-core

Platform-agnostic core shared by
[`@blinkbitcoin/esign-react-native`](../esign-react-native) and
[`@blinkbitcoin/esign-react`](../esign-react): the `SigningSource` abstraction
+ built-in sources, the Apollo client factory, and the GraphQL operations with
schema-generated types. No React, no DOM, no WebView — the platform packages
layer their `ESignature` component on top and re-export this surface.

Most apps install a platform package rather than this one directly; it arrives
as their dependency. Install directly only to build a custom integration.

## Entry points

| Import | Contents | Needs Apollo? |
|--------|----------|---------------|
| `@blinkbitcoin/esign-core` | Everything: all three sources, Apollo factory, GraphQL operations, `ErrorCode` contract | Yes (`@apollo/client` + `graphql` peers) |
| `@blinkbitcoin/esign-core/webform` | Web Forms only: `createWebFormsSource`, `createPublicUrlSource`, interpreters, `getErrorMessage`, types | **No — Apollo-free by construction** (guard-tested) |

`@apollo/client` and `graphql` are **optional** peer dependencies — required
only when the full entry (proxy mode) is used.

## The signing modes

- `createProxySigningSource` — backend creates an envelope via the GraphQL
  API (Apollo); restartable on session expiry.
- `createWebFormsSource` — DocuSign Web Forms, API-embedded: the host injects
  a `createInstance()` call to its backend, which mints the instance URL.
- `createPublicUrlSource` — a published public form URL, no backend.

Adding a provider = implementing `SigningSource` (`start()` + `interpret()`);
the platform components never change.

## Development (in this monorepo)

```sh
make test        # 75 Jest tests, 100% coverage (enforced threshold)
make codegen     # regenerate types from ../../apps/api/schema.graphql
make build       # tsup (ESM + CJS + types, both entries)
```

Types in `src/generated/` are generated — edit the backend schema, not them.
Consuming from another app: see [docs/consuming.md](../../docs/consuming.md).
