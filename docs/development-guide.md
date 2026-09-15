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
# ESIGN_SESSION_JWKS_URL=https://id.example.com/.well-known/jwks.json
# ESIGN_SESSION_SECRET=change-me

# Required when envelopes are on (DATABASE_URL) and the provider signs
# DOCUSIGN_HMAC_KEY=your-webhook-hmac-key
```

With neither set the bearer token is taken as the user id, which is what
local dev and the E2E suites run on. The boot banner says so.

`packages/esign-service/.env.example` is the complete, commented list.

## Running the Application

### Start Backend

```bash
cd packages/esign-service
npm run dev
# Server runs at http://localhost:4100
# GraphQL Playground at http://localhost:4100/graphql - only when DATABASE_URL
#   is set (it turns envelope orchestration on) and
#   ESIGN_GRAPHQL_INTROSPECTION=true (.env.test sets it; off by default)
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
`scripts/ci/changed-class.mjs`,
`scripts/coverage-badge.mjs`, `scripts/status-badge.mjs`) are thin
argv/env/git/fs wrappers and stay
excluded from that coverage measurement by design - the rule each one
applies lives in `scripts/lib/`, where it is covered. Entry points that
shell out (`scripts/ci/changed-class.mjs`, `scripts/ci/docs-freshness.sh`,
...) are exercised separately in `scripts/__tests__/*.test.mjs`, which run
the real script under a temp git repo/fixture rather than being covered by
V8 instrumentation.

### Backend E2E Tests

```bash
make e2e-backend        # database up -> migrate -> E2E -> teardown
```

Use the target rather than raw compose: it goes through
`scripts/e2e/test-db.sh`, which honours `ESIGN_PORT_BASE`. A bare
`docker-compose -f docker-compose.test.yml up -d` binds this repo's default
port, which is the wrong one in any worktree that claimed its own block
(`make ports`). The steps, if you need them one at a time:

```bash
make test-db-up
bash scripts/e2e/test-db.sh run npm run migrate:test -w packages/esign-service
bash scripts/e2e/test-db.sh run npm run test:e2e -w packages/esign-service
make test-db-down
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

<!-- BEGIN GENERATED env operator - edit packages/esign-service/src/env/registry.ts -->
| Variable | Why | When | How to obtain |
|---|---|---|---|
| `DATABASE_URL` | Decides whether this deployment orchestrates envelopes at all. Unset,<br>the mint is the whole service and no Postgres connection is opened. | default: unset - the mint alone, on every target | Your Postgres connection string. Apply the schema once with: node<br>dist/node.js migrate |
| `ESIGN_MINT_MODE` | Which of the two mints this deployment answers with. They are different<br>products: a Web Form asks the signer questions first, an envelope puts<br>them straight into the documents. | default: 'webform' | — |
| `ESIGN_PROVIDER` | Which e-signature provider mints. The mock needs no credentials and<br>signs nothing that holds. | default: 'mock' - which the boot banner reports as a demo provider | — |
| `ESIGN_SESSION_JWKS_URL` | Verifies that a caller's bearer token really came from your login<br>provider. Without a session source the service cannot tell one user from<br>another: it takes the token as the user id. | default: unset - see ESIGN_SESSION_SECRET, then the note above | Your identity provider publishes it. Take jwks_uri from its discovery<br>document: curl -s https://<issuer>/.well-known/openid-configuration \|<br>jq -r .jwks_uri Auth0, Okta, Cognito, Keycloak and Firebase all have<br>one. If your own backend issues the tokens, use ESIGN_SESSION_SECRET<br>instead - it is an equal, not a fallback. Confirm it with: node<br>dist/node.js check-session "$TOKEN" |
| `ESIGN_SESSION_SECRET` | The same verification, for a backend that issues its own tokens and<br>signs them with a shared secret. | default: unset | The secret your own backend signs session tokens with - the same value,<br>not a new one. Prefer ESIGN_SESSION_JWKS_URL when you have an identity<br>provider: this service then holds no signing material and cannot mint<br>tokens even if it is compromised. |
| `ESIGN_SESSION_ISSUER` | Pins which issuer a token may come from. Without it any token your key<br>material verifies is accepted, whoever issued it. | default: unset - the issuer is not checked | The iss claim of a real token, copied exactly: echo "$TOKEN" \| cut -d.<br>-f2 \| base64 -d \| jq -r .iss Trailing slashes count. check-session<br>names both sides when they differ. |
| `ESIGN_SESSION_AUDIENCE` | Pins which audience a token was minted for, so a token issued for<br>another service of yours is not accepted here. | default: unset - the audience is not checked | The aud claim of a real token: echo "$TOKEN" \| cut -d. -f2 \| base64 -d<br>\| jq -r .aud |
| `ESIGN_SESSION_USER_CLAIM` | Which claim carries your user id. DocuSign sees this value as<br>clientUserId, so it is what ties a signature to a person. | default: 'sub' | Look at a real token and pick the claim holding your user id: echo<br>"$TOKEN" \| cut -d. -f2 \| base64 -d \| jq |
| `ESIGN_PREFILL_URL` | Decides who computes the values a signer cannot change. Unset, the<br>client's own prefill is minted as sent - which is fine for a fixed<br>consent form and wrong for anything whose fields carry the deal. | default: unset - the client's prefill is minted as sent | An endpoint on your own backend that you write. It receives { userId,<br>input }        (an envelope mint also sends recipient) and answers {<br>prefill: { ... } }     (and, for an envelope, an optional recipient)<br>Confirm it answers correctly with: node dist/node.js check-prefill |
| `ESIGN_PREFILL_SECRET` | Lets your prefill endpoint tell this service apart from anything else<br>that finds the URL. | default: unset - the header is not sent | Any high-entropy string you also configure on the receiving endpoint:<br>openssl rand -hex 32 |
| `ESIGN_PREFILL_TIMEOUT_MS` | Bounds how long a mint waits on your backend before answering 502. | default: 5000 | — |
| `ESIGN_STRICT` | Turns every line the boot banner reports as unverified into a refusal to<br>start. Off by default because what an unverified session or a<br>client-supplied prefill means depends on your architecture, which this<br>process cannot see. | default: unset - the service reports its posture and starts | — |
| `DOCUSIGN_INTEGRATION_KEY` | Identifies your application to DocuSign. Without the JWT-grant<br>credentials nothing can be minted. | ESIGN_PROVIDER=docusign | DocuSign Admin -> Apps and Keys. The full click path, including the<br>consent step that is easy to miss, is<br>docs/integration/docusign-proxy.md. The integration key is the GUID<br>shown on the app. |
| `DOCUSIGN_ACCOUNT_ID` | Which DocuSign account the envelopes and instances belong to. | ESIGN_PROVIDER=docusign | DocuSign Admin -> Account -> API and Keys: the "API Account ID" GUID,<br>not the account number. |
| `DOCUSIGN_USER_ID` | Whom the service impersonates. Envelopes are sent as this user. | ESIGN_PROVIDER=docusign | DocuSign Admin -> Users -> the service user -> "API Username" (a GUID).<br>That user must have granted consent once. |
| `DOCUSIGN_PRIVATE_KEY` | Proves the service is the integration key it claims to be. The only<br>DocuSign value that is a secret. | ESIGN_PROVIDER=docusign | Generate a keypair, upload the public half on the integration key:<br>openssl genrsa -out esign.pem 2048 && openssl rsa -in esign.pem -pubout<br>Paste the private PEM verbatim. DocuSign Admin -> Apps and Keys. The<br>full click path, including the consent step that is easy to miss, is<br>docs/integration/docusign-proxy.md. Alternatives:<br>DOCUSIGN_PRIVATE_KEY_BASE64 (every target), DOCUSIGN_PRIVATE_KEY_FILE (a<br>container secret mount). |
| `DOCUSIGN_PRIVATE_KEY_BASE64` | The same key where a multi-line environment value is awkward. | instead of DOCUSIGN_PRIVATE_KEY | base64 -i esign.pem |
| `DOCUSIGN_PRIVATE_KEY_FILE` | The same key from a mounted secret, so it never appears in the<br>environment. | instead of DOCUSIGN_PRIVATE_KEY | The path a secret is mounted at, e.g. /run/secrets/docusign.pem.<br>Container-only: a Worker has no filesystem. |
| `DOCUSIGN_WEBFORM_ID` | Which Web Form the mint creates an instance of. | the Web Form mint (ESIGN_MINT_MODE=webform) | DocuSign -> Web Forms -> the form -> its id in the URL. The form must be<br>active. |
| `DOCUSIGN_TEMPLATE_ID` | Which template(s) an envelope is created from. | ESIGN_MINT_MODE=envelope, or envelope orchestration | DocuSign -> Templates -> the template -> its id. `make<br>docusign-template` creates the fixture one and prints its id. |
| `DOCUSIGN_RETURN_URL` | Where DocuSign sends the signer afterwards. It must reach this service's<br>bridge, which is what reports completion back to your app. | ESIGN_PROVIDER=docusign | This deployment's public URL plus /signing/return. It has to be<br>reachable by the signer's browser, not just by the service. |
| `DOCUSIGN_SIGNER_ROLE` | Which template role the signer fills. | default: 'signer' | The role name on the template, as spelled there. |
| `DOCUSIGN_HMAC_KEY` | Proves an inbound webhook really came from DocuSign. Without it anyone<br>who finds the URL can write 'completed' into your envelope records. | default: unset - the banner reports an unverified webhook | DocuSign Admin -> Connect -> your configuration -> Add HMAC key.<br>DocuSign shows the secret once. |
| `DOCUSIGN_BASE_URL` | Which DocuSign environment this is. The default is the demo one, which<br>signs nothing that holds up. | default: the demo host - reported as a sandbox by the boot banner | DocuSign Admin -> API and Keys shows your account's base URI, e.g.<br>https://na4.docusign.net/restapi The region prefix differs per account. |
| `DOCUSIGN_OAUTH_URL` | Where the JWT grant is exchanged. It has to match the environment of the<br>account. | default: the demo host | https://account.docusign.com for production; the default is the demo<br>host. |
| `DOCUSIGN_WEBFORMS_BASE_URL` | Where Web Forms instances are minted. Same environment rule again. | default: the demo host | https://apps.docusign.com/api/webforms/v1.1 for production; the default<br>is the demo host. |
| `PORT` | Which port the Node target listens on. A function target is told by its<br>platform. | default: ESIGN_PORT_BASE (4100) | — |
| `ESIGN_TRUST_PROXY` | Whether x-forwarded-for may be believed. It is a caller-controlled<br>header, so believing it without a proxy in front lets anyone spoof their<br>address past the rate limits. | default: unset - x-forwarded-for is ignored | Set it to true only when something you control terminates connections in<br>front of this service. |
| `ESIGN_CORS_ALLOWED_ORIGINS` | Which browser origins may call the mint and the GraphQL API. | default: unset - same-origin only | The origins of your own web app, e.g. https://app.example.com. |
| `ESIGN_RATE_LIMIT_WEBFORM_PER_MIN` | Caps mints per client per minute. Each one costs a real DocuSign<br>instance. | default: 60 | — |
| `ESIGN_RATE_LIMIT_ENVELOPE_PER_MIN` | The same cap for the envelope mint. | default: 60 | — |
| `ESIGN_RATE_LIMIT_WEBHOOK_PER_MIN` | Caps inbound webhooks, which arrive unauthenticated until the signature<br>is checked. | default: 120 | — |
| `ESIGN_RATE_LIMIT_GRAPHQL_PER_MIN` | Caps GraphQL requests per client. | default: 100 | — |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | Turns tracing on. Off unless set, so no deployment ships spans it did<br>not ask for. | default: unset - tracing off | Your collector's OTLP endpoint, e.g. http://localhost:4318. Any OTLP<br>backend works. |
| `OTEL_SERVICE_NAME` | What this service is called in traces. | default: 'esign-service' | — |
<!-- END GENERATED -->
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
| `checks.yml` | `workflow_call` only | First stage, all static: `Changes` (classifies the change - PR or push alike: when every changed file is<br>docs/, `*.md`, a `LICENSE` or a template, Unit, E2E and Badges are skipped and<br>main ships no prerelease; the rule is `scripts/lib/docs-only.mjs`), `Code` (`make audit`, actionlint via<br>`scripts/ci/actionlint.sh`, `make shellcheck`, `make check-parity` = the<br>workflows call the make targets, diagram freshness, `make check-code` = lint +<br>typecheck + format), `Commits` (Conventional Commits on the PR's commits and title; PRs only), `Docs` (warns when architecture-relevant files change without a docs/ update; fails for a diagram source without its SVG) |
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
free on a public repo; on a private repo macOS bills at 10x Linux (one 12-14 min
run is 120-140 Linux minutes), which is why the job was opt-in before the repo
went public. `ci.yml` passes `ios: true` to `e2e.yml` unless one of these says
otherwise; a skipped job costs nothing and the `E2E` badge describes what
actually ran.

| Switch | Effect |
|--------|--------|
| Repo variable `E2E_IOS=false` | Pauses iOS on every run (`gh variable set E2E_IOS --body false`; delete the variable to resume). |
| PR label `e2e:ios` | Forces iOS for that PR while paused (labeling triggers a run). |
| Repo variable `E2E_IOS_RUNNER` | `runs-on` for the iOS job, default `macos-latest`. Set to self-hosted label(s), e.g. `["self-hosted","macOS","arm64"]`, and GitHub-hosted macOS is never used. |

What keeps the setup before Maestro at its floor on a 3-vCPU hosted runner
(measured in blinkbitcoin/kyc#16, the same job): the simulator boots first
and only downloads overlap it, Metro starts after the boot, Metro's transform
cache is restored from the last green run (`METRO_CACHE_ROOT`,
`scripts/e2e/metro-start.sh`), and the prewarm requests the exact bundle
options the dev client asks for, so the app-launch flow is served from the
warm graph instead of building its own. What is left, 12-14 min here, is
Maestro: the XCUITest driver install and the flows themselves, which swing
run to run. Change the order or the prewarm URL only with the step timings
of a run in hand.

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
# The whole Checks stage (static only). check-ci is the superset: actionlint,
# shellcheck, the dependency audit, and the make/workflow parity gate.
make check-code check-ci codegen-check diagrams-check docs-check
make changed-class      # will this branch skip the matrix? (CI's Changes job)
make commitlint         # Conventional Commits on origin/main..HEAD

# GitHub's CodeQL analysis, locally (never in a workflow: GitHub runs it there).
# Same language and config, so a finding shows up here before the push. Every
# finding counts as open, because GitHub ignores the SARIF suppression an
# inline marker produces - see .github/codeql/codeql-config.yml.
# The CLI comes from the flake on first use (nix shell .#codeql, one large fetch)
make codeql

# Unit
make coverage

# E2E
make build check-packages   # Build Packages (publint + attw + the pack/install smoke)
make pack               # the publishable tarballs, into dist-tarballs/
make deploy-check       # the deploy templates (compose, Worker bundle, k8s)
make docker-smoke       # Docker: build the service image and boot it in both modes
make docker-smoke-mint-only   # the mint-only demo image
make e2e-server-demos   # Server demos
make e2e-backend        # Backend
make e2e-web            # Web (Playwright; builds the libraries, then bundles + previews the demo)
make e2e-android        # Android: emulator running, APK built, Metro + backend up (see `make help`)
make e2e-ios            # iOS: simulator booted with the app installed, Metro + backend up
make e2e-ios-local      # the whole iOS stack in one command (or e2e-android-local with an emulator running)

# Release plumbing
make version            # what a push to main would publish; make version TAG=vX.Y.Z for a release
make release            # merge the open release PR (release-please) - the whole stable release step
make release-rc V=X.Y.Z-rc.1   # hand-cut a prerelease-suffixed tag (ships under next)
make registry-smoke V=X.Y.Z    # Verify: install what was published and assert the contract
make image-smoke REF=ghcr.io/blinkbitcoin/esign-service:X.Y.Z   # the same for the image

# Badges
make coverage-badge     # the coverage SVG, from the last `make coverage`
make badges             # the Unit/E2E stage SVGs (UNIT=/E2E= to see a red one)
```

Two jobs have no local twin on purpose: **Publish** needs a registry token, and
**Badges** pushes to `gh-pages`. Everything they compute before that point does
run locally - `make pack` builds the tarballs Publish uploads, `make badges`
renders the SVGs it publishes, `make docker-build ARCHIVE=<path>` saves the
image it pushes - so only the credentialed step is unreproducible.

`make check-ci` fails if a workflow step runs a command a make target already
runs (`scripts/ci/make-parity.mjs`). That is what keeps this list true: CI and
the Makefile cannot drift into two definitions of the same job.
