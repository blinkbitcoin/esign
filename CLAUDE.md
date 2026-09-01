# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

E-signature integration monorepo (npm workspaces). The **backend service** is
the main deliverable together with the **publishable React Native library**;
the demo app exists for manual and E2E testing.

| Workspace | Path | Role |
|-----------|------|------|
| `backend` | `apps/api/` | Express 5 + Apollo Server 5 GraphQL API, Knex/PostgreSQL, provider adapters (DocuSign/mock), webhooks |
| `@blinkbitcoin/esign-core` | `packages/esign-core/` | Platform-agnostic core: `SigningSource` abstraction + sources, Apollo factory, GraphQL operations + codegen (no React/DOM) |
| `@blinkbitcoin/esign-react-native` | `packages/esign-react-native/` | Publishable RN library: `ESignature` component (WebView) over core |
| `@blinkbitcoin/esign-react` | `packages/esign-react/` | Publishable React **web** library: `ESignature` (iframe) + DocuSign.js source over core |
| `esign-react-native-example` | `examples/react-native-demo/` | RN 0.86 demo app hosting the RN library (Maestro E2E target) |
| `esign-react-example` | `examples/react-demo/` | Vite web demo hosting the web library (`make web`) |

- **Language**: TypeScript everywhere (TS 6.0)
- **Node**: >= 22.11.0
- **Env management**: direnv (house convention) - `.envrc` at root (`use
  flake` + workspace bins on PATH) and in `apps/api/` (loads `.env`); the
  backend also self-loads `.env` via dotenv as a non-direnv fallback
- **Toolchain**: pinned by `flake.nix` (node 24, jdk 17, ruby 3.3, watchman);
  entered automatically via direnv, or `nix develop`. CI uses plain
  setup-node - the flake is convenience, not a hard requirement
- **Current-state docs**: `docs/index.md` - maintained by hand alongside code changes
- **Diagrams**: `docs/diagrams/README.md` and `docs/diagrams/dist/*.svg`
  are GENERATED - edit `docs/diagrams/src/*.mmd` and run `make diagrams`
  (renders SVGs via pinned mermaid-cli + reassembles the doc; a pre-commit
  hook does this automatically; CI fails on drift)

## Commands (repo root)

Makefiles exist at three levels: the root (repo-wide flows), the group dirs
(`apps/`, `packages/`, `examples/` - fan common targets out to auto-discovered
children), and each workspace (thin delegates to its npm scripts). So
`make -C packages coverage` runs both libraries, `cd apps/api && make dev`
runs the service. Root targets: `make test` (unit + check-code), `make e2e-backend` (DB up → migrate
→ E2E → teardown), `make db-up/migrate/backend`, `make ios/android/start`,
`make pods`, `make build`, `make clean/reset`. The underlying npm scripts:

```bash
npm ci                       # Install all workspaces
npm test                     # All test suites: library (Jest), demo (Jest), backend (Vitest)
npm run test:coverage        # Coverage runs - 100% is the enforced baseline
npm run typecheck            # tsc across all workspaces
npm run lint                 # ESLint (mobile code) + Biome lint (backend)
npm run format               # Biome format (all workspaces)
npm run build                # Build the library (react-native-builder-bob)
npm start                    # Metro for the demo app
npm run ios / android        # Run the demo app
npm run backend              # Backend dev server (tsx watch)
npm run test:e2e:backend     # Backend E2E (needs: docker compose -f docker-compose.test.yml up -d)
npm run test:e2e             # Maestro mobile E2E (needs backend + simulator)
```

Single test file: `npm test -w @blinkbitcoin/esign-react-native -- ESignature` or
`npm test -w apps/api -- tests/webhook.test.ts`.

## Backend specifics

```bash
cd apps/api
npm run migrate              # Knex migrations (TS, run via tsx)
npm run migrate:test         # Same against the .env.test database
```

- DB access via repository modules (`envelope.ts`, `audit.ts`) with optional
  Knex transactions; never query inline in resolvers.
- Provider work goes through the `ESignProvider` port (`src/providers/port.ts`) -
  including webhooks + Web Forms (`createWebFormInstance`). Adapters live in
  `src/providers/` (`docusign/` split into adapter + client + mapping + config;
  `mock.ts`); the factory + singleton are `src/providers/index.ts`. Nothing
  DocuSign-specific outside `src/providers/docusign/`.
- The wire contract is the `ErrorCode` enum in `apps/api/schema.graphql`
  (emitted from `src/typeDefs.ts`). After schema changes run `make codegen`;
  drift fails backend tests, client parity tests, and a CI step.
- Security is fail-closed by default: `validateSecurityConfig` (`src/config.ts`)
  refuses to boot without `JWT_SECRET` (and `DOCUSIGN_HMAC_KEY` when
  `ESIGN_PROVIDER=docusign`) unless `ALLOW_INSECURE_DEV=true` is explicitly set.
  This is NOT gated on `NODE_ENV`. Missing DocuSign provider config also throws
  at boot. The webhook handler enforces a terminal-state machine (no
  transitions out of completed/voided/declined) to block replay-downgrades.

## Library specifics

- Public API is `src/index.ts`; the host app provides the Apollo client
  (via `createESignApolloClient`) and all native peer deps.
- No URLs, tokens, or platform detection in the library - that's host-app
  (demo) wiring.
- **Provider-agnostic**: `ESignature` takes a `SigningSource` (not
  contract/Apollo details). The abstraction + the proxy/webforms/public sources
  + event interpreters live in `@blinkbitcoin/esign-core`. Add a provider =
  a new `SigningSource`; the component never changes.
- Native-module mocks live in `packages/esign-react-native/__mocks__/`
  and are reused by the demo's jest config.
- The platform-agnostic code (the `SigningSource` abstraction + sources, the
  Apollo client factory, the GraphQL operations + generated types) lives in
  **`@blinkbitcoin/esign-core`** (`packages/esign-core/`), depended on
  and re-exported by both the RN and web packages. Each platform package now
  contains only its `ESignature` component (+ web-only `docusignWebForms.ts`).
  Codegen runs in core; the KEPT-IN-SYNC duplication is gone.

## iOS Setup (first time or after native dep changes)

```bash
cd examples/react-native-demo
bundle install
cd ios && bundle exec pod install
```

## Troubleshooting

```bash
npm start -- --reset-cache                            # Clear Metro cache
watchman watch-del . && watchman watch-project .      # Stale watchman after file moves
cd examples/react-native-demo/android && ./gradlew clean               # Clean Android build
cd examples/react-native-demo/ios && xcodebuild clean                  # Clean iOS build
rm -rf node_modules package-lock.json && npm install  # Full reinstall (root lockfile only)
```

## Code Style

- TypeScript for all new files; functional components with hooks
- Prefer `StyleSheet.create()` for styles
- ESLint 9 flat config (`@react-native` via FlatCompat) for mobile linting; Biome for formatting
- Git hooks via lefthook (auto-installed by `npm install`): biome + eslint on pre-commit, typecheck on pre-push
  everywhere and backend linting
- `graphql` is pinned to 16.x repo-wide (Apollo Server 5's peer range) - do
  not bump it to 17 until Apollo Server supports it

## Architecture Patterns

- **Provider pattern**: new e-sign providers implement the five-method
  `ESignProvider` interface in one file + a factory case
- **Safe Area**: `react-native-safe-area-context` (demo app concern)
- **Entry points**: `examples/react-native-demo/index.js` (app), `apps/api/src/index.ts`
  (service bootstrap), `packages/esign-react-native/src/index.ts`
  (library API)
