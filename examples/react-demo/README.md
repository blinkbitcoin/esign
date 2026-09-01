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
| `vite.config.ts` | Workspace alias resolving the library straight to source |

## Testing

```sh
make test          # Vitest (jsdom) unit tests (5); coverage floors enforced - E2E is the real coverage
make e2e           # Playwright browser E2E in real Chromium (proxy mode;
                   #   needs the test DB - or run `make e2e-web` at repo root)
                   # Web Forms / public-URL variants: make e2e-web-webform /
                   #   e2e-web-publicurl at the repo root
make build         # production build sanity check
```

The browser E2E is the only place the iframe postMessage path runs against a
genuinely cross-origin signing page (app :5173, page :4000).
