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
- **Node**: ^22.22.2 || >= 24.15.0 (floor set by jsdom 30)
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
runs the service. `make help` lists every root target with a description.
The ones that matter most: `make test` (unit + check-code), `make coverage`,
`make check-ci` (actionlint + shellcheck of `scripts/**`), `make codegen`,
`make diagrams` / `make docs-check`, `make e2e-backend` (DB up → migrate →
E2E → teardown), `make e2e-web[-webform|-publicurl]` (Playwright), `make
e2e-android` / `make e2e-ios` (Maestro, needs a running stack; `make
e2e-backend-up` starts the mock-provider backend), `make db-up/migrate/backend`,
`make ios/android/start/web`, `make pods`, `make build`, `make release V=X.Y.Z`,
`make clean/reset`. The underlying npm scripts:

```bash
npm ci                       # Install all workspaces
npm test                     # All test suites: core + RN + web libraries, both demos (Jest), backend (Vitest)
npm run test:coverage        # Coverage runs - 100% is the enforced baseline on packages + backend
npm run typecheck            # tsc across all workspaces
npm run lint                 # ESLint (mobile code) + Biome lint (backend)
npm run format               # Biome format (all workspaces)
npm run build                # Build the three libraries (bob for RN, tsup for core + web)
npm run check:packages       # publint + arethetypeswrong on the built packages (CI: E2E / Build Packages)
npm run codegen              # Emit schema.graphql from typeDefs.ts + regenerate core's client types
npm start                    # Metro for the RN demo app
npm run ios / android        # Run the RN demo app
npm run web                  # Vite dev server for the web demo
npm run backend              # Backend dev server (tsx watch)
npm run test:e2e:backend     # Backend E2E (needs: docker compose -f docker-compose.test.yml up -d)
npm run test:e2e             # Maestro mobile E2E (needs backend + simulator/emulator)
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
  and re-exported by both the RN and web packages. Each platform package
  contains only its `ESignature` component (+ web-only `docusignWebForms.ts`).
  Codegen runs in core (`packages/esign-core/src/generated/`); never hand-edit
  or duplicate the generated types in a platform package.

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
- Do all branch work in a git worktree (`git worktree add ../esign-<topic> -b <branch> origin/main`),
  never by switching branches in the main clone: several agent sessions share
  that checkout, and a commit made there lands on whatever branch another
  session left checked out
- Git hooks via lefthook (auto-installed by `npm install`): biome + eslint +
  diagram re-render on pre-commit, commitlint on commit-msg, typecheck on
  pre-push, `npm ci` on post-merge/post-checkout when the lockfile changed.
  Escape hatches: `git commit --no-verify`, `LEFTHOOK=0 git push`
- Commit messages and PR titles follow Conventional Commits with an allowed
  scope list: `core`, `rn`, `react`, `api`, `demo`, `e2e`, `ci`, `deps`,
  `deps-dev`, `docs`, `release` (`commitlint.config.mjs` is the source of
  truth; e.g. `feat(rn): ...`, `fix(api): ...`, `ci(e2e): ...`, `docs: ...`).
  Squash merges take the PR title, so name the PR like a commit. Details in
  `CONTRIBUTING.md`
- Change code and the relevant `docs/` page in the same change; the CI Docs
  check (`make docs-check`) flags architecture-relevant diffs without one
- Shell that CI or the Makefile runs lives in `scripts/{ci,e2e,release}/`,
  never inline in a workflow; `make check-ci` runs actionlint + shellcheck
- `graphql` is pinned to 16.x repo-wide (Apollo Server 5's peer range) - do
  not bump it to 17 until Apollo Server supports it

## CI and releases

- One pipeline per branch (`ci.yml`): Checks (`checks.yml`: Changes, Code,
  Commits, Docs - all static) → Unit (`test.yml`) → E2E (`e2e.yml`: Build
  Packages → Web, Backend, Build Android → Android, Build iOS → iOS) → Badges,
  then Publish → Verify on `main`. Build Packages is the one build of the
  libraries: Web bundles the demo against its dist and Publish ships its
  tarballs unchanged. Docs-only PRs stop after Checks; `main` skips docs-only
  pushes.
- iOS E2E runs by default (public repo: GitHub-hosted macOS is free). Pause it
  with repo variable `E2E_IOS=false`; PR label `e2e:ios` forces it for one PR
  while paused; `E2E_IOS_RUNNER` overrides `runs-on`.
- Native E2E builds are cached on the inputs `scripts/native-deps-hash.sh`
  sees plus `android/**` / `ios/**`; bump the cache key's `v` suffix when an
  input the script cannot see changes.
- Releases: prerelease (`next`) on every green push to `main`; stable is
  `make release V=X.Y.Z` - the tag is the version, CI stamps it at publish
  time, `package.json` stays at `0.0.0-development`. Release notes come from
  PR titles (`.github/release.yml`). A release ships only once the commit's
  main run is green (`release-retry.yml` re-runs a blocked Publish).

## Architecture Patterns

- **Provider pattern**: new e-sign providers implement the `ESignProvider`
  port (`apps/api/src/providers/port.ts`) as an adapter under
  `apps/api/src/providers/` + a case in the `src/providers/index.ts` factory
- **Safe Area**: `react-native-safe-area-context` (demo app concern)
- **Entry points**: `examples/react-native-demo/index.js` (RN app),
  `examples/react-demo/src/main.tsx` (web app), `apps/api/src/index.ts`
  (service bootstrap), `packages/esign-{core,react-native,react}/src/index.ts`
  (library APIs)
