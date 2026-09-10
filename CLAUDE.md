# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

E-signature integration monorepo (npm workspaces). The deliverables are the
**four publishable packages** (two client libraries, their core, and the
server package). The examples are reference hosts: two client demos and
three server shapes, used for manual testing and every E2E suite.

| Workspace | Path | Role |
|-----------|------|------|
| `@blinkbitcoin/esign-core` | `packages/esign-core/` | Platform-agnostic core: `SigningSource` abstraction + sources, Apollo factory, GraphQL operations + codegen (no React/DOM) |
| `@blinkbitcoin/esign-server` | `packages/esign-server/` | Node-only server half: DocuSign client (JWT grant, envelopes, Web Forms) + `createWebFormInstance` (the one call for locked prefill) + the envelope domain (`createEnvelopeService` over the `ESignProvider` and `EnvelopeStore` ports); the backend is built on it, hosts with their own backend import it |
| `@blinkbitcoin/esign-react-native` | `packages/esign-react-native/` | Publishable RN library: `ESignature` component (WebView) over core |
| `@blinkbitcoin/esign-react` | `packages/esign-react/` | Publishable React **web** library: `ESignature` (iframe) + DocuSign.js source over core |
| `esign-react-native-example` | `examples/react-native-demo/` | RN 0.86 demo app hosting the RN library (Maestro E2E target) |
| `esign-react-example` | `examples/react-demo/` | Vite web demo hosting the web library (`make web`) |
| `esign-full-service-example` | `examples/full-service-demo/` | The whole service on the server package: Express router + Apollo + Knex/PostgreSQL + webhooks; the backend every E2E suite runs against, ships as the `esign-api` image |
| `esign-mint-only-example` | `examples/mint-only-demo/` | An existing GraphQL API adds one mutation that mints a locked Web Forms instance (the Blink API shape) |
| `esign-serverless-handler-example` | `examples/serverless-handler-demo/` | The package's Fetch handlers (mint + webhook) behind a route handler; plain Node adapter |
| `tooling` | `scripts/` | CI/release scripts; `lib/*.mjs` unit-tested at 100% (Vitest) |

- **Language**: TypeScript everywhere (TS 6.0)
- **Node**: ^22.22.2 || >= 24.15.0 (floor set by jsdom 30)
- **Env management**: direnv (house convention) - `.envrc` at root (`use
  flake` + workspace bins on PATH) and in `examples/full-service-demo/` (loads `.env`); the
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
(`packages/`, `examples/` - fan common targets out to auto-discovered
children), and each workspace (thin delegates to its npm scripts). So
`make -C packages coverage` runs both libraries, `cd examples/full-service-demo && make dev`
runs the service. `make help` lists every root target with a description.
The ones that matter most: `make test` (unit + check-code), `make coverage`,
`make check-ci` (actionlint + shellcheck of `scripts/**`), `make codegen`,
`make diagrams` / `make docs-check`, `make e2e-backend` (DB up → migrate →
E2E → teardown), `make e2e-web[-webform|-publicurl]` (Playwright), `make
e2e-android` / `make e2e-ios` (Maestro, needs a running stack; `make
e2e-backend-up` starts the mock-provider backend), `make db-up/migrate/backend`,
`make ios/android/start/web`, `make pods`, `make build`, `make docker-build` /
`make docker-smoke` (the service image, `examples/full-service-demo/Dockerfile`), `make release`,
`make clean/reset`. The underlying npm scripts:

```bash
npm ci                       # Install all workspaces
npm test                     # All test suites: core + RN + web libraries, both demos (Jest), backend + tooling scripts (Vitest)
npm run test:coverage        # Coverage runs - 100% is the enforced baseline on every workspace
npm run typecheck            # tsc across all workspaces
npm run lint                 # ESLint (mobile code) + Biome lint (backend)
npm run format               # Biome format (all workspaces)
npm run build                # Build the four packages (bob for RN, tsup for core + server + web)
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
`npm test -w examples/full-service-demo -- tests/webhook.test.ts`.

## Backend specifics

```bash
cd examples/full-service-demo
npm run migrate              # The package's migrations (src/migrate.ts via tsx)
npm run migrate:test         # Same against the .env.test database
```

- The domain (authorization, validation, persistence + audit, restart rule,
  webhook state machine) is `createEnvelopeService` from
  `@blinkbitcoin/esign-server`, composed in `src/services.ts`; resolvers
  (`src/schema.ts`) and routes (`src/app.ts`) only map inputs/outputs.
- DB access is the package's Knex `EnvelopeStore` (`@blinkbitcoin/esign-server/knex`),
  composed over the shared client in `src/store.ts`; the schema is the
  package's programmatic migration source (`src/migrate.ts` applies it, no
  migration files here). Never query inline in resolvers.
- Provider work goes through the package's `ESignProvider` port - including
  webhooks + hosted forms (`createHostedFormInstance`). `src/providers/docusign/`
  and `src/providers/mock.ts` are the package adapters wired to the service's
  config and policy; selection is the package's `providerFromEnv` registry
  (`src/providers/index.ts`). **Provider boundary, everywhere:** nothing
  provider-specific outside a `providers/<name>/` directory - in the packages
  (`packages/esign-core/src/providers/docusign/`,
  `packages/esign-react/src/providers/docusign/`, `packages/esign-server/src/providers/docusign/`)
  and in the service. The generic layers (`signing/`, the port, the pages, the
  handlers) never import a provider; guard tests enforce it. DocuSign code is
  reached through the `./docusign` subpaths, whose `src/docusign.ts` entry
  files are one-line re-exports of `providers/docusign/` (guard tests);
  `./webform` stays as an alias.
- The api resolves `@blinkbitcoin/esign-server` from source for typecheck,
  tests and `tsx` dev (`tsconfig.json` paths + vitest aliases); `npm run
  build` (`tsconfig.build.json`) needs the package's dist, so build the
  packages first (`npm run build` at the root).
- The wire contract is the `ErrorCode` enum in `examples/full-service-demo/schema.graphql`
  (the SDL lives in `packages/esign-server/src/graphql.ts`, re-exported by
  `src/typeDefs.ts`). After schema changes run `make codegen`;
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
  and re-exported by both the RN and web packages. The signing **state
  machine** is in core too (`packages/esign-core/src/signing/machine.ts`:
  `transition`, `acquireSession`, `resolveRestart`, the shared status /
  error / result / options / theme / labels types). Each platform package
  contains its `ESignature` component (the default UI), the headless
  `useESignature` hook (the machine's runner: connectivity probe, message
  transport, success delay, embed), and `theme.ts` (+ the web-only DocuSign.js
  source under `providers/docusign/`). Never re-implement a transition in a hook - add
  it to the machine and its table test.
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
  scope list: `core`, `server`, `rn`, `react`, `demo`, `e2e`, `ci`, `deps`,
  `deps-dev`, `docs`, `release` (`commitlint.config.mjs` is the source of
  truth; e.g. `feat(rn): ...`, `fix(server): ...`, `ci(e2e): ...`, `docs: ...`).
  Squash merges take the PR title, so name the PR like a commit. Details in
  `CONTRIBUTING.md`
- Change code and the relevant `docs/` page in the same change; the CI Docs
  check (`make docs-check`) flags architecture-relevant diffs without one
- **README tables**: GitHub sizes columns by content, so one long cell
  squeezes the first column until `make coverage-badge` wraps word by word.
  Every table cell line stays at or under 72 visible characters, broken with
  `<br>`; `make docs-check` (`scripts/ci/docs-tables.mjs`) fails otherwise -
  the rule is enforced, not remembered.
- **Coverage rows with nothing to cover**: a re-export barrel or type-only
  module shows as 0% without lowering the totals. Exclude it in the
  workspace's coverage config; `make coverage` (`scripts/ci/coverage-empty.mjs`)
  fails on any such row.
- Shell that CI or the Makefile runs lives in `scripts/{ci,e2e,release}/`,
  never inline in a workflow; `make check-ci` runs actionlint + shellcheck
- **Ports**: every service listens on `ESIGN_PORT_BASE` (default 4100) +
  its offset - table `scripts/lib/ports.mjs`, shell via
  `scripts/e2e/ports-env.sh`, Playwright via `examples/react-demo/e2e/ports.ts`;
  `ESIGN_PORT_BASE=4300 make e2e-web` moves a whole worktree. Never write a
  port literal outside those defaults; `scripts/lib/ports.test.mjs` checks
  each service's declared offset against the table.
- `graphql` is pinned to 16.x repo-wide (Apollo Server 5's peer range) - do
  not bump it to 17 until Apollo Server supports it

## CI and releases

- One pipeline per branch (`ci.yml`): Checks (`checks.yml`: Changes, Code,
  Commits, Docs - all static) → Unit (`test.yml`) → E2E (`e2e.yml`: Build
  Packages → Web, Docker, Backend, Build Android → Android, Build iOS → iOS)
  → Badges, then Publish → Verify on `main`. Build Packages is the one build
  of the libraries: Web bundles the demo against its dist and Publish ships
  its tarballs unchanged. Docker is the one build of the service image
  (smoked with the mock provider); Publish ships it to GHCR as
  `ghcr.io/blinkbitcoin/esign-api:<version>` + `:latest` / `:next`.
  Docs-only PRs stop after Checks; `main` skips docs-only pushes.
- iOS E2E runs by default (public repo: GitHub-hosted macOS is free). Pause it
  with repo variable `E2E_IOS=false`; PR label `e2e:ios` forces it for one PR
  while paused; `E2E_IOS_RUNNER` overrides `runs-on`.
- Live DocuSign E2E is opt-in: repo variable `E2E_LIVE=true` (main, releases,
  dispatch) or PR label `e2e:live` (same-repo PRs); secrets live in the
  `docusign-demo` environment. `docs/operations/live-e2e-ci.md`.
- Native E2E builds are cached on the inputs `scripts/native-deps-hash.sh`
  sees plus `android/**` / `ios/**`; bump the cache key's `v` suffix when an
  input the script cannot see changes.
- Releases: prerelease (`next`) on every green push to `main`; stable is
  merging the `chore(release): X.Y.Z` PR that release-please opens once a
  feat/fix lands (`make release`). That tags `vX.Y.Z`, writes the GitHub
  Release from `CHANGELOG.md`, and dispatches `ci.yml` at the tag - the tag
  is the version, CI stamps it at publish time, the four package.json files
  stay at `0.0.0-development`. Never hand-edit CHANGELOG.md or the root
  `package.json` version. A release ships only once the commit's main run is
  green (`release.yml`'s retry job re-runs a blocked Publish). `docs/releasing.md`.

## Testing rules

- Tests are silent: `jest.setup.ts` / `vitest.setup.ts` in every workspace
  fail a test on any console output. Inject a logger instead of letting a
  module fall back to the console (`silentLogger` / `spyLogger()` from
  `packages/esign-server/src/__tests__/support.ts`; the `logger` option of
  `createESignApolloClient`, `useESignature` and the demos' factories); wrap
  every React state update in an act-aware API (`fireEvent`, `waitFor`,
  `findBy*`, `ReactTestRenderer.act`), never a raw DOM `.click()` or a bare
  awaited promise; a test that expects a log line spies on the console
  method in the test or a `beforeEach` (never `beforeAll`). Check a run under
  a pty, not through a filter.

## Architecture Patterns

- **Provider pattern**: a new e-sign provider is an adapter directory
  (`packages/esign-server/src/<name>/` implementing the `ESignProvider` port,
  client-side interpreters under `packages/esign-core/src/providers/<name>/`)
  plus one entry in the `providerFromEnv` registry; hosts select it with
  `ESIGN_PROVIDER=<name>`
- **Safe Area**: `react-native-safe-area-context` (demo app concern)
- **Entry points**: `examples/react-native-demo/index.js` (RN app),
  `examples/react-demo/src/main.tsx` (web app), `examples/full-service-demo/src/index.ts`
  (service bootstrap), `packages/esign-{core,react-native,react}/src/index.ts`
  (library APIs)
