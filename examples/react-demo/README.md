# examples/react-demo

Vite + React app hosting `@blinkbitcoin/esign-react` — the web integration
reference. Not a product; a host.

## Run It

```sh
# 1. Backend (from repo root)
make db-up migrate backend        # Postgres + migrations + server at :4000

# 2. App (from this directory)
make dev                          # Vite dev server (URL printed on start)
```

The demo points at `http://localhost:4000/graphql` (`src/config.ts`) and
sends a fixed dev bearer token (`src/apollo.ts`) that the backend's dev
passthrough treats as the userId.

## What to Look At

| File | Shows |
|------|-------|
| `src/App.tsx` | Minimal host wiring + outcome reporting around the component |
| `src/apollo.ts` | `createESignApolloClient({ uri, getAuthToken })` — the host owns both |
| `src/HookSigning.tsx` | Hook-driven custom signing UI (`useESignature` + the host's own buttons and iframe); toggled from the toolbar, default UI stays the E2E target |
| `vite.config.ts` | Resolves the library to source while serving (dev, vitest) and to its built `dist` when building - the E2E suites build + preview, so they test what a consumer installs |

## Testing

```sh
make test          # Vitest (jsdom) unit tests (22); 100% coverage enforced - E2E drives the real iframe
make e2e           # Playwright browser E2E in real Chromium (proxy mode;
                   #   needs the test DB and the libraries built - or run
                   #   `make e2e-web` at the repo root, which does both)
                   # Web Forms / public-URL variants: make e2e-web-webform /
                   #   e2e-web-publicurl at the repo root
make build         # production build sanity check
```

The browser E2E is the only place the iframe postMessage path runs against a
genuinely cross-origin signing page (built app via `vite preview` :5173,
page :4000).
