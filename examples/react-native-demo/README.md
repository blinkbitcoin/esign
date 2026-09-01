# examples/react-native-demo

React Native 0.86 app hosting `@blinkbitcoin/esign-react-native` — the
integration reference and the Maestro E2E target. Not a product; a host.

## Run It

```sh
# 1. Backend (from repo root)
make db-up migrate backend        # Postgres + migrations + server at :4000

# 2. iOS native deps (first time / after native dep changes)
make pods                         # from this directory; or: make pods (repo root)

# 3. App (from this directory)
make dev                          # Metro (start is an alias)
make ios                          # or: make android
```

The backend URL is resolved per-platform in `src/config.ts` — iOS simulators
use `localhost`, Android emulators `10.0.2.2`; physical devices need your
machine's LAN IP.

## What to Look At

| File | Shows |
|------|-------|
| `App.tsx` | Minimal host wiring: `ApolloProvider` + the component + outcome callbacks |
| `src/apollo.ts` | `createESignApolloClient({ uri, getAuthToken })` — the host owns both |
| `src/config.ts` | Platform-aware dev URL resolution |
| `.maestro/` | E2E flows: happy path, cancel-from-signing-page, session-timeout→restart (all drive the real mock signing page inside the WebView) |

## Testing

```sh
make test          # Jest unit tests (12), 100% coverage baseline
make e2e           # Maestro (needs backend running + app installed on a simulator)
```

The demo sends a fixed dev bearer token; the backend's dev passthrough
(`JWT_SECRET` unset) treats it as the userId — no login flow required.
