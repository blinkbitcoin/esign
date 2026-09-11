# examples/react-native-demo

React Native 0.86 app hosting `@blinkbitcoin/esign-react-native` — the
integration reference and the Maestro E2E target. Not a product; a host.

## Run It

```sh
# 1. Backend (from repo root)
make db-up migrate backend        # Postgres + migrations + server at :4100

# 2. iOS native deps (first time / after native dep changes)
make pods                         # from this directory; or: make pods (repo root)

# 3. App (from this directory)
make dev                          # Metro (start is an alias)
make ios                          # or: make android
```

The backend URL is resolved per-platform in `src/config.ts` — iOS simulators
use `localhost`, Android emulators `10.0.2.2`; a physical device passes the
host it can reach. Five `ESIGN_*` variables are inlined into the bundle by
Babel when Metro starts: `ESIGN_MODE` (`proxy` | `webform`),
`ESIGN_PORT_BASE` (the repo's base port, default 4100; the backend is +0),
`ESIGN_BACKEND_HOST` (the backend's host outright: the Mac's tailnet address
for an iPhone, `localhost` through `adb reverse` for an Android phone -
`make live-ios` / `make live-android` set it), `ESIGN_BACKEND_PORT` (the
backend's port outright, for the live run) and `ESIGN_PREFILL` (a JSON
object replacing the demo's mock-form prefill, for a real form).

## What to Look At

| File | Shows |
|------|-------|
| `App.tsx` | Minimal host wiring: `buildSource()` picks the mode via `ESIGN_MODE` (proxy /<br>webform / publicurl; Apollo only in proxy mode) + outcome callbacks |
| `src/apollo.ts` | `createESignApolloClient({ uri, getAuthToken })` — the host owns both |
| `src/config.ts` | Platform-aware dev URL resolution |
| `src/HookSigning.tsx` | Hook-driven custom signing UI (`useESignature` + the host's own buttons<br>and WebView); toggled from the toolbar, default UI stays the E2E target |
| `.maestro/` | E2E flows: app-launch, happy path, cancel-from-signing-page,<br>session-timeout→restart, webform-happy-path (tagged `webform`; needs an<br>`ESIGN_MODE=webform` Metro), webform-live (tagged `live`; the real DocuSign<br>form to a signed envelope, run by `make e2e-ios-live` from the repo root).<br>All drive real pages inside the WebView |

## Testing

```sh
make test          # Jest unit tests (29); 100% coverage enforced - E2E drives the real WebView
make e2e           # Maestro, iOS (needs backend running + app installed on a simulator)
make e2e-android   # Maestro, Android (adb reverse handles Metro + backend ports)
# repo root: make e2e-ios-local / make e2e-android-local - the whole stack in one command (DB, backend, build, Metro, Maestro, teardown)
# repo root: make e2e-ios-live - the real DocuSign Web Form in the WebView, signed (needs the DocuSign .env)
# repo root: make live-ios / make live-android - this app on the attached phone against real DocuSign, interactive
```

The demo sends a fixed dev bearer token; the backend's dev passthrough
(`JWT_SECRET` unset) treats it as the userId — no login flow required.
