# Development Guide

**Project:** esign
**Updated:** 2026-09-10

## Prerequisites

| Requirement | Version | Purpose |
|-------------|---------|---------|
| Node.js | ^22.22.2 or ≥24.15 | Runtime (floor set by jsdom 30) |
| npm | Latest | Package management |
| Docker | Latest | Test database |
| Xcode | Latest | iOS builds (macOS only) |
| Android Studio | Latest | Android builds |
| Ruby | 3.2+ | CocoaPods (iOS) |
| direnv | Latest | Env management (house convention) - `brew install direnv` + shell hook |
| Nix (flakes) | Latest | Toolchain pinning via `flake.nix` (node 24, jdk 17, ruby 3.3, watchman) - loaded by direnv's `use flake` |

## Initial Setup

### 1. Clone and Install

```bash
# Clone repository
git clone <repository-url>
cd esign

# Install all workspaces (library, demo app, backend - single root lockfile)
npm ci

# Enable direnv (once per machine) - loads .env files, enters the nix
# flake dev shell (pinned node/jdk/ruby/watchman), and puts workspace
# bins (tsx, knex, biome, ...) on PATH
direnv allow . && direnv allow packages/esign-service
```

Without direnv/nix, any Node 22.22+ or 24.15+ plus a JDK 17 and Ruby 3.2+ works -
the flake is the convenient, pinned path, not a hard requirement (CI uses
plain setup-node).

The examples and the deploy templates carry no flake of their own. They are
workspaces under the root, so direnv finds the root `.envrc` from any
subdirectory and they already have the pinned toolchain; and each one models
a consumer, who installs a published package under the `engines` range and
never needs Nix. An operator whose hosts are Nix-managed has a Nix path too,
and it is a deploy target rather than a dev shell: the NixOS row of
[the deploy table](../packages/esign-service/README.md#deploy).

### 2. iOS Setup (macOS only)

```bash
cd examples/react-native-demo
bundle install                     # Ruby deps (CocoaPods)
cd ios && bundle exec pod install  # iOS native deps
```

### 3. Backend Database Setup

```bash
# Start development database
cd packages/esign-service
docker-compose up -d

# Run migrations
npm run migrate
```

### 4. Environment Configuration

Environment is managed with **direnv** (house convention): `.envrc` files load
`.env`/`.env.local` when you `cd` in. The backend also self-loads `.env` via
`dotenv/config` as a fallback for non-direnv environments (CI, IDE launchers) -
dotenv never overrides direnv-exported values, so precedence is consistent.

**Backend (`packages/esign-service/.env`):**
```env
DATABASE_URL=postgresql://dev:dev@localhost:4113/esign   # make db-up's Postgres: ESIGN_PORT_BASE + 13
ESIGN_PROVIDER=mock            # 'docusign' for the real integration
PORT=4100                      # ESIGN_PORT_BASE + 0 (docs/architecture/backend.md)

# Required when ESIGN_PROVIDER=docusign (server fails fast if missing)
# DOCUSIGN_ACCOUNT_ID=your-account-id
# DOCUSIGN_INTEGRATION_KEY=your-integration-key
# DOCUSIGN_USER_ID=your-user-id
# DOCUSIGN_PRIVATE_KEY=-----BEGIN RSA PRIVATE KEY-----...
# DOCUSIGN_TEMPLATE_ID=your-template-id

# Session verification - one of these, or the service refuses to boot
# SESSION_JWKS_URL=https://id.example.com/.well-known/jwks.json
# SESSION_HS256_SECRET=change-me   # JWT_SECRET is an accepted alias

# Required when envelopes are on (DATABASE_URL) and the provider signs
# DOCUSIGN_HMAC_KEY=your-webhook-hmac-key

# The explicit opt-in to running without either (local dev only)
ALLOW_INSECURE_DEV=true
```

`packages/esign-service/.env.example` is the complete, commented list.

## Running the Application

### Start Backend

```bash
cd packages/esign-service
npm run dev
# Server runs at http://localhost:4100
# GraphQL Playground at http://localhost:4100/graphql - only when DATABASE_URL
#   is set (it turns envelope orchestration on) and ESIGN_ENV is not
#   'production' (which disables introspection)
```

### Start Mobile (Metro)

```bash
# In project root
npm start
```

### Run on Device/Simulator

```bash
# iOS
npm run ios

# Android
npm run android
```

## Development Commands

A `Makefile` at the repo root wraps all common flows (house convention) -
run `make help` for the list. Highlights: `make test` (unit + check-code),
`make e2e-backend` (full DB lifecycle), `make db-up migrate backend`.

Git hooks (lefthook, auto-installed by `npm install` via the `prepare`
script): pre-commit formats + lints staged files (Biome, auto-fixes are
re-staged; ESLint on TS/TSX), commit-msg enforces Conventional Commits
(commitlint), pre-push runs the workspace typecheck, and post-merge /
post-checkout re-run `npm ci` when the lockfile changed. Skip once with
`git commit --no-verify`; CI remains the authoritative gate. Commit message
format, scopes, and PR conventions: [CONTRIBUTING.md](../CONTRIBUTING.md).

The npm scripts underneath:

### Root orchestration (npm workspaces)

| Command | Description |
|---------|-------------|
| `npm test` | All suites: library + demo + backend |
| `npm run typecheck` | tsc across all workspaces |
| `npm run build` | Build the packages (bob for RN, tsup for core/node/react, tsc for the service) |

### Demo app / library

| Command | Description |
|---------|-------------|
| `npm start` | Start Metro bundler (demo) |
| `npm run ios` | Run on iOS simulator |
| `npm run android` | Run on Android emulator |
| `npm test` | Run Jest tests |
| `npm run lint` | Run ESLint |
| `npm run format` | Format with Biome |

### Backend

| Command | Description |
|---------|-------------|
| `npm run dev` | Start dev server (tsx watch) |
| `npm run build` | Compile TypeScript |
| `npm start` | Run production build |
| `npm test` | Run unit tests |
| `npm run test:e2e` | Run E2E tests |
| `npm run migrate` | Run Knex migrations |
| `npm run lint` | Run Biome lint |
| `npm run format` | Format with Biome |

## Testing

Three tiers, by what they touch:

1. **Unit + E2E suites are hermetic and mock-only by design.** The Maestro
   and Playwright flows drive the **mock provider's** signing pages (which
   emit the real DocuSign event vocabulary) - their assertions target mock
   page content that a real DocuSign ceremony does not render. Setting
   `DOCUSIGN_*` variables does **not** (and should not) point these suites
   at real DocuSign.
2. **Live API verification is env-gated:** `make test-live` runs real JWT
   auth + envelope creation + Web Forms instance minting against a DocuSign
   demo account when `DOCUSIGN_*` is set in `packages/esign-service/.env`, and skips
   itself entirely when not. Safe to run anytime; in CI only as the opt-in
   `Live DocuSign` job ([operations/live-e2e-ci.md](operations/live-e2e-ci.md)).
3. **Live UI verification is automated too, locally:** `make e2e-live`
   drives the real Web Form (locked terms, submission, signature, bridge)
   and a proxy-mode signature inside the web component in a real browser;
   `make e2e-ios-live` repeats the Web Form journey in the React Native
   demo's WebView on a booted simulator. Findings and rules:
   [integration/docusign-lessons.md](integration/docusign-lessons.md).
   The manual smoke-test checklist in
   [integration/docusign-proxy.md](integration/docusign-proxy.md) (section
   5) remains for anything the flows do not cover; `make live-web`,
   `make live-ios` and `make live-android` bring up the stack for it (the
   service on DocuSign, a Tailscale Funnel public URL for Connect webhooks,
   the demo on the attached phone) and tear it down on Ctrl-C.

### Mobile Unit Tests

```bash
# Run all tests
npm test

# Run specific test file
npm test -- ESignature.test.tsx

# Watch mode
npm test -- --watch
```

### Backend Unit Tests

```bash
cd packages/esign-service

# Run all tests
npm test

# Run with coverage
npm test -- --coverage

# Watch mode
npm test -- --watch
```

### Tooling Scripts

The CI/release logic under `scripts/` is its own `tooling` npm workspace
(`npm run test -w scripts`, `npm run test:coverage -w scripts`). Pure logic
lives in `scripts/lib/*.mjs` (semver parsing, version resolution, badge
rendering) and is covered by Vitest at the same 100% bar as the publishable
packages and the backend; the CLI entry points that wrap it
(`scripts/release/resolve-version.mjs`, `scripts/ci/manifest-structural.mjs`,
`scripts/coverage-badge.mjs`, `scripts/status-badge.mjs`) are thin
argv/env/git/fs wrappers and stay
excluded from that coverage measurement by design. Shell scripts
(`scripts/ci/changed-class.sh`, `scripts/ci/docs-freshness.sh`, ...) are
exercised separately in `scripts/__tests__/*.test.mjs`, which shell out to
the real script under a temp git repo/fixture rather than being covered by
V8 instrumentation.

### Backend E2E Tests

```bash
# Start test database
docker-compose -f docker-compose.test.yml up -d

# Wait for database
docker-compose -f docker-compose.test.yml exec -T postgres-test pg_isready -U test -d esign_test

# Run migrations
npm run migrate:test

# Run E2E tests
npm run test:e2e

# Cleanup
docker-compose -f docker-compose.test.yml down
```

### Mobile E2E Tests (Maestro)

```bash
# Install Maestro CLI
curl -Ls "https://get.maestro.mobile.dev" | bash

# The whole stack in one command, torn down on the way out: E2E Postgres,
# the mock-provider backend, the debug build, Metro, the Maestro suite
make e2e-ios-local        # boots a simulator when none is booted
make e2e-android-local    # needs a running emulator (emulator -avd <name> &)

# Or step by step (what CI runs as separate jobs)
make test-db-up && npm run migrate:test -w packages/esign-service
make e2e-backend-up       # mock provider on ESIGN_API_PORT
make ios-build            # or: make android-build (the emulator's ABI)
make e2e-metro-up         # Metro in the background, bundle prewarmed (METRO_PLATFORM=android for Android)
make e2e-ios              # or: make e2e-android
make e2e-metro-down && make e2e-backend-down && make test-db-down
```

The flows launch the app once (`app-launch` runs first) and reset between
flows with the demo's **Start over** control instead of relaunching - see
[docs/architecture/mobile.md](architecture/mobile.md#e2e-tests-maestro).
A flow that needs a truly fresh process should `launchApp` with the default
`stopApp: true` inside a `retry` block, as `app-launch.yaml` does.

## Code Style

### TypeScript
- Strict mode enabled
- Prefer interfaces over types
- Explicit return types on functions

### React Native
- Functional components with hooks
- `StyleSheet.create()` for styles
- Safe area handling via `useSafeAreaInsets()`

### Backend
- Fetch handlers: `Request` in, `Response` out - no framework, no middleware
  chain, so an async failure is caught where it happens and mapped to a
  status code (`packages/esign-node/src/handlers.ts`)
- GraphQL error codes for client handling
- Audit logging for all state changes

### Formatting
```bash
# Check formatting
npm run format:check

# Fix formatting
npm run format
```

### Linting
```bash
# Check for issues
npm run lint

# Auto-fix issues
npm run lint:fix
```

## Database Operations

### Knex Commands

```bash
cd packages/esign-service

# Create migration
npx tsx "$(command -v knex)" migrate:make -x ts <migration-name>

# Apply migrations
npm run migrate

# Roll back the last migration batch
npx tsx "$(command -v knex)" migrate:rollback

# Check migration status
npx tsx "$(command -v knex)" migrate:status
```

> Migrations are TypeScript files, and the `knex` CLI can't load `.ts`
> config/migration files on its own — run it through `tsx` (resolving the CLI
> via `command -v knex`, since bins hoist to the workspace root), or use the
> `npm run migrate` script for the common `migrate:latest` case.

## Troubleshooting

### Metro Cache Issues
```bash
npm start -- --reset-cache
```

### iOS Build Issues
```bash
cd examples/react-native-demo/ios
xcodebuild clean
rm -rf Pods Podfile.lock
bundle exec pod install
```

### Android Build Issues
```bash
cd examples/react-native-demo/android
./gradlew clean
```

### Node Modules Issues
```bash
rm -rf node_modules package-lock.json
npm install
```

### Migration Issues
```bash
cd packages/esign-service
npx tsx "$(command -v knex)" migrate:status
npm run migrate
```

## Environment Variables Reference

### Backend

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | No | PostgreSQL connection string. Its presence turns **envelope orchestration** on (GraphQL, the webhook, the Knex store); without it the deployment serves the mint alone |
| `ESIGN_PROVIDER` | No | Provider selection: `mock` (default) or `docusign` |
| `MOCK_PAGES` | No | `false` turns the mock provider's signing pages off |
| `DOCUSIGN_ACCOUNT_ID` | docusign | DocuSign account ID |
| `DOCUSIGN_INTEGRATION_KEY` | docusign | DocuSign integration key |
| `DOCUSIGN_USER_ID` | docusign | DocuSign user ID (GUID) |
| `DOCUSIGN_PRIVATE_KEY` | docusign | RSA private key in PEM format |
| `DOCUSIGN_TEMPLATE_ID` | docusign | DocuSign template ID; several, comma-separated, are sent as one envelope in that order (the signer role at the same routing order in each) |
| `DOCUSIGN_SIGNER_ROLE` | no | The template role the signer fills (default `signer`, what `make docusign-template` names it) |
| `DOCUSIGN_WEBFORM_ID` | webform mode | Web Forms form id (from the builder) |
| `DOCUSIGN_WEBFORMS_BASE_URL` | no | Web Forms API base (defaults to demo) |
| `DOCUSIGN_BASE_URL` | no | eSignature REST base (defaults to the demo environment) |
| `DOCUSIGN_OAUTH_URL` | no | OAuth host for the JWT grant (defaults to demo) |
| `DOCUSIGN_RETURN_URL` | no | Where DocuSign redirects after signing (defaults to the built-in return-URL bridge) |
| `OTEL_*` | no | Standard OpenTelemetry vars; tracing is off unless set (`OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_SERVICE_NAME`, `OTEL_TRACES_EXPORTER=console` for stdout) |
| `ESIGN_ENV` | no | `production` declares this deployment production: demo provider settings and demo DocuSign hosts are refused at boot, GraphQL introspection is off, and a missing `TERMS_URL` needs `ESIGN_ALLOW_CLIENT_PREFILL`. **`NODE_ENV` gates nothing** |
| `ESIGN_ALLOW_DEMO` | no | `true` is the one bypass of that refusal (a production-shaped staging deployment) |
| `SESSION_JWKS_URL` | one of the two | Remote key set (RS/ES) for session verification |
| `SESSION_HS256_SECRET` | one of the two | Shared secret instead (`JWT_SECRET` is an accepted alias). With neither, the service **refuses to boot** unless `ALLOW_INSECURE_DEV=true` |
| `SESSION_ISSUER`, `SESSION_AUDIENCE` | no | Enforced when set |
| `SESSION_USER_CLAIM` | no | The claim carrying the user id (default `sub`) |
| `TERMS_URL` | prod | Where the host computes the prefill actually minted. Required under `ESIGN_ENV=production` unless `ESIGN_ALLOW_CLIENT_PREFILL=true` |
| `TERMS_SHARED_SECRET`, `TERMS_TIMEOUT_MS` | no | Sent as `x-esign-terms-secret`; default 5000 ms |
| `TERMS_ALLOW_INSECURE` | no | `true` to allow a plaintext `TERMS_URL` in production (only for a private host the guard cannot recognise) |
| `ESIGN_ALLOW_CLIENT_PREFILL` | no | `true` to mint the client's own prefill in production |
| `ALLOW_INSECURE_DEV` | no | Explicit opt-in to run without session verification and without webhook signatures (never in prod) |
| `CORS_ALLOWED_ORIGINS` | no | Comma-separated CORS allow-list |
| `DOCUSIGN_HMAC_KEY` | envelopes + docusign | Webhook HMAC validation secret. Missing: webhooks are rejected (fail-closed) unless `ALLOW_INSECURE_DEV=true`; with envelopes on and the DocuSign provider the boot guard refuses to start without it |
| `PORT` | No | Server port (default: `ESIGN_PORT_BASE` + 0 = 4100). **Container only** |
| `TRUST_PROXY` | No | `true` to take the client from `x-forwarded-for` (rate limits, webhook security log). **Container only** |
| `RATE_LIMIT_WEBFORM_PER_MIN`, `RATE_LIMIT_WEBHOOK_PER_MIN`, `RATE_LIMIT_GRAPHQL_PER_MIN` | No | Per-route limits (60 / 120 / 100); `0` switches a route's limit off. **Container only** |
| `ESIGN_PORT_BASE` | No | The block's base port (default 4100); every service is base + offset (`scripts/lib/ports.mjs`). A linked worktree claims its own block into `.env.local` on first use (`.envrc` / `make`); set it only to pick a block by hand. `make ports` shows the block and its holders, `make ports-free` clears this worktree's leftovers |
| `ESIGN_TEST_DB_PORT` / `ESIGN_DEV_DB_PORT` | No | The E2E Postgres (base + 12, default 4112) and the dev Postgres (base + 13, default 4113); the compose files read them, `scripts/e2e/test-db.sh` / `dev-db.sh` export the matching `DATABASE_URL` |

The `docusign` column means required when `ESIGN_PROVIDER=docusign` — the
server refuses to start without them (fail-fast). For the full walkthrough
(account setup, consent grant, template requirements, webhook tunneling, and
the known return-URL gap) see [integration/docusign-proxy.md](integration/docusign-proxy.md).

### Mobile

The library takes the backend URL from the host app via
`createESignApolloClient({ uri })`. The demo app resolves it per-platform in
`examples/react-native-demo/src/config.ts` (Android emulators reach the host machine via
`10.0.2.2`, iOS simulators via `localhost`; `ESIGN_BACKEND_HOST` overrides
both for a physical device).

### Demo apps (bundle-time)

| Variable | App | Description |
|----------|-----|-------------|
| `ESIGN_MODE` | React Native demo (Metro) | `proxy` (default) / `webform` / `publicurl` - inlined at bundle time |
| `ESIGN_BACKEND_HOST` | React Native demo (Metro) | The backend's host for a physical device (tailnet address, or `localhost` through `adb reverse`); default `localhost` / `10.0.2.2` |
| `ESIGN_BACKEND_PORT` | React Native demo (Metro) | The backend's port outright (the live runs put the service on `LIVE_PORT`); default `ESIGN_PORT_BASE` + 0 |
| `VITE_ESIGN_MODE` | Web demo (Vite) | Same three modes for the browser demo |

## CI/CD

### GitHub Actions Workflows

One workflow file per event source, named after what runs. GitHub draws one
graph per run; the whole pipeline with its cross-workflow edges is one
diagram: [CI / Release Pipeline](diagrams/README.md#ci--release-pipeline).

| Workflow | Trigger | Purpose |
|----------|---------|---------|
| `ci.yml` | Push to main, PRs, release tag (dispatched by `release.yml`, or a hand-cut GitHub Release), manual | The one pipeline every branch runs, staged so a failure never spends the next stage's minutes: `Checks` (calls `checks.yml`) → `Unit` (calls `test.yml`) → `E2E` (calls `e2e.yml`; its `Build Packages` job is the one build of the packages), then `Badges` (coverage + Unit / E2E pass-fail badges for the branch to `gh-pages/badges/<branch>/`, after E2E so it never delays it), and on main pushes / releases / dispatch `Publish` (ships the tarballs `Build Packages` made and `Web` tested to GitHub Packages and the service image `Docker` built and smoked to GHCR as `ghcr.io/blinkbitcoin/esign-service:<version>` + `:latest` / `:next`, nothing is rebuilt: release → stable `latest`, version = the tag; main → prerelease `next`) + `Verify` (installs the published packages from GitHub Packages into a clean project and asserts the consumer contract; pulls the published image and smokes it). Workflow badge, if needed: `ci.yml/badge.svg?branch=<branch>` |
| `checks.yml` | `workflow_call` only | First stage, all static: `Changes` (classifies the PR: when every changed file is docs/, `*.md`, `LICENSE` or a template, Unit and E2E are skipped; main pushes get the same via `paths-ignore`), `Code` (audit-ci, actionlint, diagram freshness, `make check-code` = lint + typecheck + format), `Commits` (Conventional Commits on the PR's commits and title; PRs only), `Docs` (warns when architecture-relevant files change without a docs/ update; fails for a diagram source without its SVG) |
| `test.yml` | `workflow_call` only | Unit tests + coverage thresholds; uploads the coverage badge (1 day, consumed by `Badges`) and the combined HTML coverage report (`coverage-report` artifact, 30 days) |
| `e2e.yml` | `workflow_call` only | `build-packages` (version stamp, build, publint + arethetypeswrong, pack smoke; uploads the dist for `web` and the tarballs for `Publish`), `docker` (the service image from `packages/esign-service/Dockerfile`, same version stamp, smoked **twice** - once without `DATABASE_URL` (the mint alone; the envelope webhook must be absent) and once against the E2E Postgres (mint + envelopes) - `make docker-smoke` locally - and uploaded for `Publish`; also builds and smokes the mint-only demo's image, `examples/mint-only-demo/Dockerfile` - `make docker-build-mint-only && make docker-smoke-mint-only` locally - proving that shape deploys too, but it is a demo: no version stamp, no artifact upload), `server-demos` (boots the mint-only and serverless examples with the mock provider and calls their routes, including the mint-only demo's REST mint and `/health` - `make e2e-server-demos`), `live` (opt-in live DocuSign: JWT grant, real mint, Playwright on the real form; [operations/live-e2e-ci.md](operations/live-e2e-ci.md)) plus the E2E suites as jobs: `backend`, `web` (Playwright, bundles the demo against that dist - what a web consumer installs), `build-android` → `android` (emulator), and `build-ios` → `ios` (simulator), which runs by default - `E2E_IOS=false` pauses it (see below). Outputs the stamped `version` / `disttag` for `Publish` |
| `release.yml` | Push to main; CI completed on main | `Release PR / Tag` (push): keeps the `chore(release): X.Y.Z` PR current (version from the Conventional Commits since the last tag, `CHANGELOG.md` entry); when that PR merges, tags `vX.Y.Z`, creates the GitHub Release and dispatches `ci.yml` at the tag with `release_tag` (a release the workflow token creates never fires the `release:` trigger). `Re-run blocked releases` (CI completed green): re-runs the failed Publish of any release run for that commit (releases wait for / refuse a red main run). See [releasing.md](releasing.md) |
| `pull-request.yml` | PR closed; PR title edited | `Cancel in-flight runs` + `Remove branch badge` (closed): cancels the PR's still-running runs (the push-to-main run is unaffected) and removes its `gh-pages` badge directory. `Title` (edited): re-lints the PR title only; the gating lint is the `Commits` job in `checks.yml` (a title edit must not re-run the whole pipeline) |
| `codeql.yml` | Push to main, PRs, weekly | CodeQL security-and-quality analysis<br>(suite + alert-suppression query:<br>`.github/codeql/codeql-config.yml`);<br>`make codeql` runs the same analysis locally |

Badges are per branch by construction: `gh-pages/badges/X/{unit,e2e,coverage}.svg`
(and a workflow badge filtered with `?branch=X`) all describe branch `X`
and nothing else. The README shows `main`.

### iOS E2E and the macOS runner

The iOS job runs on every run. It needs a macOS runner, which GitHub hosts for
free on a public repo; on a private repo macOS bills at 10x Linux (one 7-12 min
run is 70-120 Linux minutes), which is why the job was opt-in before the repo
went public. `ci.yml` passes `ios: true` to `e2e.yml` unless one of these says
otherwise; a skipped job costs nothing and the `E2E` badge describes what
actually ran.

| Switch | Effect |
|--------|--------|
| Repo variable `E2E_IOS=false` | Pauses iOS on every run (`gh variable set E2E_IOS --body false`; delete the variable to resume). |
| PR label `e2e:ios` | Forces iOS for that PR while paused (labeling triggers a run). |
| Repo variable `E2E_IOS_RUNNER` | `runs-on` for the iOS job, default `macos-latest`. Set to self-hosted label(s), e.g. `["self-hosted","macOS","arm64"]`, and GitHub-hosted macOS is never used. |

What keeps the job at 7-12 min on a 3-vCPU hosted runner (it was ~15, and
Maestro's XCUITest driver install is most of the spread): the simulator boots
first and only downloads overlap it, Metro starts after the boot, Metro's
transform cache is restored from the last green run (`METRO_CACHE_ROOT`,
`scripts/e2e/metro-start.sh`), and the prewarm requests the exact bundle
options the dev client asks for, so the app-launch flow is served from the
warm graph instead of building its own. Change the order or the prewarm URL
only with the step timings of a run in hand.

All workflows run with `permissions: contents: read` (the publish job adds
`packages: write`; the Badges and closed-PR cleanup jobs get
`contents: write` for the ruleset-exempt `gh-pages` branch only), have
timeouts, and cancel superseded runs per ref (never a running `main` run).
`checks.yml` also runs **actionlint** over the workflow files themselves;
`.github/dependabot.yml` keeps the action versions current.

### Running CI Locally

The workflows are thin: triggers, `needs`, caches and one-line `run:` steps.
The logic lives in `scripts/ci/` (runner plumbing), `scripts/e2e/` (the E2E
stack) and `scripts/release/` (publish), exposed through `make` wherever a
human would run it - so a CI failure can be reproduced without pushing:

```bash
# The whole Checks stage (static only)
make check-code check-ci codegen-check diagrams-check docs-check

# GitHub's CodeQL analysis, locally (never in a workflow: GitHub runs it there).
# Same language, same config (suite + the alert-suppression query), so a finding
# and an inline `// codeql[<rule-id>]` marker show up here before the push;
# the CLI comes from the flake on first use (nix shell .#codeql, one large fetch)
make codeql

# Unit
make coverage

# E2E
make build && npm run check:packages && bash scripts/pack-smoke.sh   # Build Packages
make e2e-backend        # Backend
make e2e-web            # Web (Playwright; builds the libraries, then bundles + previews the demo)
make e2e-android        # Android: emulator running, APK built, Metro + backend up (see `make help`)
make e2e-ios            # iOS: simulator booted with the app installed, Metro + backend up
make e2e-ios-local      # the whole iOS stack in one command (or e2e-android-local with an emulator running)

# Release plumbing
make version            # what a push to main would publish; make version TAG=vX.Y.Z for a release
make release            # merge the open release PR (release-please) - the whole stable release step
make release-rc V=X.Y.Z-rc.1   # hand-cut a prerelease-suffixed tag (ships under next)
```
