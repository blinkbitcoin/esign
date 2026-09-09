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
| `@blinkbitcoin/esign-core/webform` | Web Forms only: `createWebFormsSource`, `createPublicUrlSource`, interpreters, `getErrorMessage`, `SigningSourceError`, types | **No — Apollo-free by construction** (guard-tested) |

`@apollo/client` and `graphql` are **optional** peer dependencies — required
only when the full entry (proxy mode) is used.

## The signing modes

- `createProxySigningSource` — backend creates an envelope via the GraphQL
  API (Apollo); restartable on session expiry.
- `createWebFormsSource` — DocuSign Web Forms, API-embedded: the host names
  its backend's mint endpoint + the prefill (`mint`, `prefill`; the source
  does the authenticated POST via `createWebFormsMinter`) or injects its own
  `createInstance()`. The backend mints with `@blinkbitcoin/esign-server`;
  read-only fields come back locked with the prefill.
- `createPublicUrlSource` — a published public form URL, no backend.

Adding a provider = implementing `SigningSource` (`start()` + `interpret()`);
the platform components never change. Optional capabilities are extra
methods the components detect: `RestartableSigningSource` (`restart()`,
guard `isRestartable`) and `MountableSigningSource<Container>` (`mount()`
for SDK-embedded UIs such as DocuSign.js on the web, guard `isMountable`).
`start()` / `restart()` reject with a
`SigningSourceError` (a real `Error` carrying a `code`; `toSigningSourceError`
normalizes any rejection into one, `isSigningSourceError` narrows).
`withTimeout(run, ms, onTimeout)` is the watchdog `createWebFormsSource` puts
around its mint call, for a custom source with the same need.
`isAllowedOrigin(session, origin)` is the postMessage origin guard the web
hook applies (`SigningSession.allowedOrigin`); a React Native WebView message
carries no origin, so the pin is a web-only defence.

The signing **state machine** itself lives here too, once for both
platforms: `initialSigningState(seed)`, `transition(state, action)` →
`{ state, effects }` (the status/error/url/session transitions for every
page event, acquisition outcome, offline/online, retry and restart, plus
the host-callback effects to run), `acquireSession(acquire)` (a start or
restart as the action it ends in, never throwing) and
`resolveRestart(source, session)`. The platform hooks keep only what
differs: the connectivity probe, how page messages arrive, and how the
session is embedded. The shared UI contracts sit next to it
(`ESignatureStatus`, `ESignatureError`, `ESignatureResult`,
`SigningCallbacks`, `UseESignatureOptions`, `ESignatureTheme`,
`ESignatureLabels`, `resolveLabelsWith`).

## Development (in this monorepo)

```sh
make test        # 75 Jest tests, 100% coverage (enforced threshold)
make codegen     # regenerate types from ../../examples/full-service-demo/schema.graphql
make build       # tsup (ESM + CJS + types, both entries)
```

Types in `src/generated/` are generated — edit the backend schema, not them.
Consuming from another app: see [docs/integration/consuming.md](../../docs/integration/consuming.md).
