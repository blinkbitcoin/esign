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
| `App.tsx` | Minimal host wiring: `buildSource()` picks the mode via `ESIGN_MODE` (proxy / webform / publicurl; Apollo only in proxy mode) + outcome callbacks |
| `src/apollo.ts` | `createESignApolloClient({ uri, getAuthToken })` — the host owns both |
| `src/config.ts` | Platform-aware dev URL resolution |
| `src/HookSigning.tsx` | Hook-driven custom signing UI (`useESignature` + the host's own buttons and WebView); toggled from the toolbar, default UI stays the E2E target |
| `.maestro/` | E2E flows: app-launch, happy path, cancel-from-signing-page, session-timeout→restart, webform-happy-path (tagged `webform`; needs an `ESIGN_MODE=webform` Metro). All drive real pages inside the WebView |

## Testing

```sh
make test          # Jest unit tests (29); 100% coverage enforced - E2E drives the real WebView
make e2e           # Maestro, iOS (needs backend running + app installed on a simulator)
make e2e-android   # Maestro, Android (adb reverse handles Metro + backend ports)
```

The demo sends a fixed dev bearer token; the backend's dev passthrough
(`JWT_SECRET` unset) treats it as the userId — no login flow required.
