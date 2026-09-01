# Development Guide

**Project:** blink-esign
**Updated:** 2026-07-02

## Prerequisites

| Requirement | Version | Purpose |
|-------------|---------|---------|
| Node.js | ≥22.11 | Runtime |
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
cd blink-esign

# Install all workspaces (library, demo app, backend - single root lockfile)
npm ci

# Enable direnv (once per machine) - loads .env files, enters the nix
# flake dev shell (pinned node/jdk/ruby/watchman), and puts workspace
# bins (tsx, knex, biome, ...) on PATH
direnv allow . && direnv allow apps/api
```

Without direnv/nix, any Node >= 22.11 plus a JDK 17 and Ruby 3.2+ works -
the flake is the convenient, pinned path, not a hard requirement (CI uses
plain setup-node).

### 2. iOS Setup (macOS only)

```bash
cd examples/react-native-demo
bundle install                     # Ruby deps (CocoaPods)
cd ios && bundle exec pod install  # iOS native deps
```

### 3. Backend Database Setup

```bash
# Start development database
cd apps/api
docker-compose up -d

# Run migrations
npm run migrate
```

### 4. Environment Configuration

Environment is managed with **direnv** (house convention): `.envrc` files load
`.env`/`.env.local` when you `cd` in. The backend also self-loads `.env` via
`dotenv/config` as a fallback for non-direnv environments (CI, IDE launchers) -
dotenv never overrides direnv-exported values, so precedence is consistent.

**Backend (`apps/api/.env`):**
```env
DATABASE_URL=postgresql://dev:dev@localhost:5432/esign
ESIGN_PROVIDER=mock            # 'docusign' for the real integration
PORT=4000

# Required when ESIGN_PROVIDER=docusign (server fails fast if missing)
# DOCUSIGN_ACCOUNT_ID=your-account-id
# DOCUSIGN_INTEGRATION_KEY=your-integration-key
# DOCUSIGN_USER_ID=your-user-id
# DOCUSIGN_PRIVATE_KEY=-----BEGIN RSA PRIVATE KEY-----...
# DOCUSIGN_TEMPLATE_ID=your-template-id

# Fail-closed in production when unset; optional in dev
# DOCUSIGN_HMAC_KEY=your-webhook-hmac-key
# JWT_SECRET=your-jwt-secret
```

## Running the Application

### Start Backend

```bash
cd apps/api
npm run dev
# Server runs at http://localhost:4000
# GraphQL Playground at http://localhost:4000/graphql
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
re-staged; ESLint on TS/TSX), pre-push runs the workspace typecheck. Skip
once with `git commit --no-verify`; CI remains the authoritative gate.

The npm scripts underneath:

### Root orchestration (npm workspaces)

| Command | Description |
|---------|-------------|
| `npm test` | All suites: library + demo + backend |
| `npm run typecheck` | tsc across all workspaces |
| `npm run build` | Build the library (react-native-builder-bob) |

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
cd apps/api

# Run all tests
npm test

# Run with coverage
npm test -- --coverage

# Watch mode
npm test -- --watch
```

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

# Start backend with mock provider against the test database
cd apps/api && ESIGN_PROVIDER=mock npx dotenv-cli -e .env.test -- npm run dev &

# Build and run app on simulator
npm run ios

# Run Maestro tests
maestro test examples/react-native-demo/.maestro/
```

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
- Express 5 async error handling
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
cd apps/api

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
cd apps/api
npx tsx "$(command -v knex)" migrate:status
npm run migrate
```

## Environment Variables Reference

### Backend

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `ESIGN_PROVIDER` | No | Provider selection: `mock` (default) or `docusign` |
| `DOCUSIGN_ACCOUNT_ID` | docusign | DocuSign account ID |
| `DOCUSIGN_INTEGRATION_KEY` | docusign | DocuSign integration key |
| `DOCUSIGN_USER_ID` | docusign | DocuSign user ID (GUID) |
| `DOCUSIGN_PRIVATE_KEY` | docusign | RSA private key in PEM format |
| `DOCUSIGN_TEMPLATE_ID` | docusign | DocuSign template ID |
| `DOCUSIGN_WEBFORM_ID` | webform mode | Web Forms form id (from the builder) |
| `DOCUSIGN_WEBFORMS_BASE_URL` | no | Web Forms API base (defaults to demo) |
| `ALLOW_INSECURE_DEV` | no | Explicit opt-in to run without JWT/HMAC secrets (never in prod) |
| `CORS_ALLOWED_ORIGINS` | no | Comma-separated CORS allow-list |
| `DOCUSIGN_HMAC_KEY` | Prod | Webhook HMAC validation secret. Unset: dev allows all webhooks (warns); production rejects all (fail-closed) |
| `JWT_SECRET` | Prod | HS256 JWT verification secret. Unset: dev treats bearer token as userId; production treats requests as unauthenticated (fail-closed) |
| `PORT` | No | Server port (default: 4000) |

The `docusign` column means required when `ESIGN_PROVIDER=docusign` — the
server refuses to start without them (fail-fast). For the full walkthrough
(account setup, consent grant, template requirements, webhook tunneling, and
the known return-URL gap) see [integration/docusign-proxy.md](integration/docusign-proxy.md).

### Mobile

The library takes the backend URL from the host app via
`createESignApolloClient({ uri })`. The demo app resolves it per-platform in
`examples/react-native-demo/src/config.ts` (Android emulators reach the host machine via
`10.0.2.2`, iOS simulators via `localhost`).

## CI/CD

### GitHub Actions Workflows

| Workflow | Trigger | Purpose |
|----------|---------|---------|
| `test.yml` | Push/PR (non-main) + publish gate | Unit tests + coverage thresholds + check-code |
| `e2e-backend.yml` | Push/PR (non-main) + publish gate | Backend E2E tests |
| `e2e-mobile.yml` | Push/PR (non-main) + publish gate | Mobile E2E tests (iOS simulator + Android emulator) |
| `e2e-web.yml` | Push/PR (non-main) + publish gate | Web browser E2E (Playwright) |
| `publish.yml` | GitHub Release → stable; main push / manual → prerelease (`next`) | Publish to GitHub Packages, gated on all four test workflows |
| `docs-check.yml` | Push/PR to main | Warns when architecture-relevant changes ship without a docs/ update |

All workflows run with `permissions: contents: read` (publish adds
`packages: write`), have timeouts, and cancel superseded runs per ref.
`test.yml` also runs **actionlint** over the workflow files themselves;
`.github/dependabot.yml` keeps the action versions current.

### Running CI Locally

```bash
# Backend E2E (mimics CI)
docker-compose -f docker-compose.test.yml up -d --wait
cd apps/api && npm run test:e2e
docker-compose -f docker-compose.test.yml down
```
