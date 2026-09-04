# Source Tree Analysis

**Project:** @blinkbitcoin/esign-react-native monorepo (npm workspaces)
**Updated:** 2026-07-02

## Repository Structure

```
esign/
│
├── 🧩 SHARED CORE (platform-agnostic)
│   │
│   └── packages/esign-core/
│       ├── src/
│       │   ├── index.ts           # Full entry (incl. Apollo factory) ⭐
│       │   ├── webform.ts         # Apollo-free entry (./webform) ⭐
│       │   ├── signing/           # SigningSource abstraction + 3 sources
│       │   ├── client.ts          # createESignApolloClient + ErrorCodes
│       │   ├── operations.ts      # GraphQL mutations (wire contract)
│       │   ├── generated/         # Codegen output (from apps/api schema)
│       │   └── __tests__/         # incl. webform-entry Apollo-free guard
│       ├── codegen.ts             # GraphQL Codegen config
│       └── dist/                  # tsup output (gitignored)
│
├── 📦 LIBRARY - THE PRODUCT
│   │
│   └── packages/esign-react-native/
│       ├── package.json           # Publishable; peerDeps for all natives
│       ├── tsconfig.json / tsconfig.build.json
│       ├── babel.config.js / jest.config.js
│       │
│       ├── src/
│       │   ├── index.ts           # Public API (full; re-exports core) ⭐
│       │   ├── webform.ts         # Apollo-free entry (./webform subpath) ⭐
│       │   ├── ESignature.tsx     # Signing flow component (source-driven) ⭐
│       │   ├── types.ts           # Props/status/error types
│       │   └── __tests__/         # incl. webform-entry Apollo-free guard
│       │
│       ├── __mocks__/             # webview + netinfo mocks (shared with demo)
│       └── lib/                   # builder-bob output (gitignored)
│
├── 📦 WEB LIBRARY - THE PRODUCT (web flavor)
│   │
│   └── packages/esign-react/
│       ├── src/                   # Same public API as the RN package:
│       │   ├── index.ts           #   ESignature (iframe) over the core
│       │   ├── ESignature.tsx
│       │   ├── docusignWebForms.ts# DocuSign.js SDK source (web-only)
│       │   └── types.ts
│       ├── tsup.config.ts         # ESM + CJS + d.ts build
│       └── dist/                  # Build output (gitignored)
│
├── 🌐 WEB EXAMPLE APP
│   │
│   └── examples/react-demo/
│       ├── index.html / src/main.tsx
│       ├── src/App.tsx            # Host wiring around the web component
│       ├── src/apollo.ts          # createESignApolloClient({uri, getAuthToken})
│       └── vite.config.ts         # Vite + vitest; lib from source when serving, dist when building
│
├── 📱 EXAMPLE APP (integration / E2E host)
│   │
│   └── examples/react-native-demo/
│       ├── App.tsx                # Demo wiring: ApolloProvider + handlers
│       ├── index.js / app.json    # App registration
│       ├── src/
│       │   ├── apollo.ts          # createESignApolloClient({uri, getAuthToken})
│       │   └── config.ts          # Platform-aware backend URL
│       ├── __tests__/ __mocks__/  # App tests + safe-area mock
│       ├── ios/  android/         # Native projects (node-resolved RN paths)
│       ├── .maestro/              # Mobile E2E flows
│       ├── metro.config.js        # watchFolders -> workspace root
│       └── Gemfile / .bundle/     # CocoaPods tooling
│
├── 🖥️ BACKEND (Express + Apollo)
│   │
│   └── apps/api/
│       ├── package.json           # Backend dependencies
│       ├── tsconfig.json          # TypeScript configuration
│       ├── knexfile.ts            # Knex CLI configuration
│       ├── biome.json             # Biome lint + format configuration
│       ├── vitest.config.ts       # Unit test config (with coverage)
│       ├── vitest.e2e.config.ts   # E2E test config (sequential)
│       ├── .env.example           # Documented environment variables
│       ├── .env.test              # Test database connection (tracked)
│       │
│       ├── migrations/            # Knex migrations (TypeScript) ⭐
│       │
│       ├── src/
│       │   ├── index.ts           # Bootstrap (dotenv + startServer)
│       │   ├── server.ts          # startServer(port) - testable ⭐
│       │   ├── app.ts             # Express + Apollo setup ⭐
│       │   ├── schema.ts          # GraphQL schema + resolvers ⭐
│       │   ├── db.ts              # Knex instance (fail-fast)
│       │   ├── auth.ts            # JWT verification (HS256)
│       │   │
│       │   ├── providers/         # Port + factory + adapters ⭐
│       │   │   ├── port.ts        #   ESignProvider + supportsWebForms
│       │   │   ├── index.ts       #   factory/singleton (tracing-wrapped)
│       │   │   ├── mock.ts        #   mock adapter
│       │   │   └── docusign/      #   adapter + client + mapping + config
│       │   │
│       │   ├── envelope.ts        # Envelope repository (Knex)
│       │   ├── webhook.ts         # Generic webhook processing ⭐
│       │   ├── audit.ts           # Audit logging repository
│       │   │
│       │   ├── errors.ts          # GraphQL error factories
│       │   ├── types.ts           # Shared types incl. ESignProvider
│       │   │
│       │   └── __mocks__/
│       │       └── db.ts          # knex-mock-client for unit tests
│       │
│       └── tests/
│           ├── setup.ts           # Unit test setup (auto-mocks db)
│           ├── *.test.ts          # Unit tests (Vitest)
│           │
│           └── e2e/
│               ├── setup.ts       # E2E setup (real DB, migrations)
│               ├── factories.ts   # Test data factories
│               ├── envelope.e2e.test.ts
│               ├── webhook.e2e.test.ts
│               └── signing-flow.e2e.test.ts
│
├── 🔧 CONFIGURATION
│   │
│   ├── Makefile                   # Repo-wide dev entry points (make help);
│   │                              # apps/, packages/, examples/ have fan-out
│   │                              # Makefiles; each workspace a local one
│   ├── package.json               # Workspace root: orchestration scripts
│   ├── .envrc                     # direnv: .env loading + use flake + workspace bins
│   ├── flake.nix / flake.lock     # Nix dev shell: node 24, jdk 17, ruby 3.3, watchman
│   ├── docker-compose.test.yml    # E2E test database (tmpfs, port 5433)
│   ├── babel.config.js            # Root Babel (for ESLint's parser only)
│   ├── eslint.config.js           # ESLint 9 flat config (@react-native via FlatCompat)
│   ├── lefthook.yml               # Git hooks: biome+eslint pre-commit, typecheck pre-push
│   ├── biome.json                 # Formatter config (backend has its own)
│   ├── .editorconfig              # Editor + Biome defaults
│   ├── .gitattributes             # EOL normalization; protects pbxproj/gradlew.bat
│   ├── .npmrc                     # engine-strict (enforces engines 22.22+ / 24.15+)
│   │
│   └── .github/
│       └── workflows/
│           ├── e2e-backend.yml    # Backend E2E CI
│           └── e2e-mobile.yml     # Mobile E2E CI
│
├── 📚 DOCUMENTATION
│   │
│   ├── README.md                  # Project README
│   ├── CLAUDE.md                  # AI assistant instructions
│   ├── AGENTS.md                  # Agent instructions
│   │
│   └── docs/                      # Current-state documentation (this folder)
```

## Critical Paths

### Library Critical Paths

| Path | Purpose |
|------|---------|
| `packages/esign-react-native/src/index.ts` | Public API |
| `packages/esign-react-native/src/ESignature.tsx` | Core signing component |
| `packages/esign-react-native/src/client.ts` | Apollo factory + error-code contract |

### Demo Critical Paths

| Path | Purpose |
|------|---------|
| `examples/react-native-demo/App.tsx` | Host wiring: provider + callbacks |
| `examples/react-native-demo/src/config.ts` | Platform-aware backend URL |
| `examples/react-native-demo/.maestro/` | E2E test flows |

### Backend Critical Paths

| Path | Purpose |
|------|---------|
| `apps/api/src/app.ts` | Server factory |
| `apps/api/src/schema.ts` | GraphQL API |
| `apps/api/src/webhook.ts` | Generic webhook processing |
| `apps/api/src/types.ts` | ESignProvider interface |
| `apps/api/src/providers/index.ts` | Provider factory + singleton |
| `apps/api/migrations/` | Database schema |
| `apps/api/tests/e2e/` | E2E tests |

## Integration Points

How the parts communicate (GraphQL, webhooks, WebView events, database):
see [integration.md](integration.md). Per-part
entry points are listed in each architecture doc.
