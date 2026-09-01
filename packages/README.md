# packages/

Publishable client libraries — the products of this repo. The two platform
packages expose the same public API over a shared core; pick by platform.

| Package | What it is |
|---------|------------|
| [`esignature-core/`](esignature-core/README.md) | 🧩 `@blinkbitcoin/esignature-core` — platform-agnostic core: `SigningSource` abstraction + sources, Apollo factory, GraphQL operations + codegen. Dependency of both platform packages. |
| [`esign-react-native/`](esign-react-native/README.md) | 📦 `@blinkbitcoin/esign-react-native` — RN signing component (WebView) over core |
| [`esign-react/`](esign-react/README.md) | 📦 `@blinkbitcoin/esign-react` — React web signing component (iframe + DocuSign.js source) over core |

All three publish to GitHub Packages — see
[docs/consuming.md](../docs/consuming.md). Web Forms-only consumers use the
Apollo-free `/webform` subpath entries (guard-tested; `@apollo/client` and
`graphql` are optional peers).

`make help` here fans common targets (`test`, `coverage`, `typecheck`,
`build`, `codegen`, `clean`) out to every package; packages with a `Makefile`
are discovered automatically. Types under `esignature-core/src/generated/`
come from `apps/api/schema.graphql` — edit the backend schema and run
`make codegen`, never the generated files.
