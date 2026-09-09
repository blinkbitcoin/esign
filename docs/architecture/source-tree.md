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
│       │   ├── docusign.ts        # The DocuSign entry, Apollo-free (./docusign) ⭐
│       │   ├── webform.ts         # Alias of ./docusign (./webform) ⭐
│       │   ├── signing/           # SigningSource abstraction + machine.ts (the state machine) + labels.ts
│       │   │   ├── bridge.ts      #   interpretBridgeEvent: the neutral `{ event }` protocol the bridge/mock pages post
│       │   │   ├── hostedForm/    #   provider-neutral hosted-form source, minter, public-URL source (interpreter injectable)
│       │   │   └── ...            #   proxySource (Apollo) + deprecated shims at the old DocuSign paths
│       │   ├── providers/docusign/# DocuSign: interpretDocuSignEvent, the prefill contract, the Web Forms sources
│       │   ├── client.ts          # createESignApolloClient + ErrorCodes
│       │   ├── operations.ts      # GraphQL mutations (wire contract)
│       │   ├── generated/         # Codegen output (from examples/full-service-demo schema)
│       │   └── __tests__/         # incl. the webform-entry Apollo-free guard + the signing/ ↛ providers/ guard
│       ├── codegen.ts             # GraphQL Codegen config
│       └── dist/                  # tsup output (gitignored)
│
├── 🖥️ SERVER LIBRARY (Node-only; the backend is built on it)
│   │
│   └── packages/esign-server/
│       ├── src/
│       │   ├── index.ts           # Public API: client, domain, handlers, prefill ⭐
│       │   ├── express.ts         # ./express entry: createESignRouter, pages via signingPage.ts (express is a peer) ⭐
│       │   ├── knex.ts            # ./knex entry: Knex EnvelopeStore + migration source (knex is a peer) ⭐
│       │   ├── docusign.ts        # ./docusign entry: the DocuSign adapter on its own (peer-free) ⭐
│       │   ├── knex/              #   store.ts, migrations.ts (ESIGN_MIGRATIONS, programmatic source)
│       │   ├── envelopes.ts       # createEnvelopeService: rules, audit, webhook state machine ⭐
│       │   ├── provider.ts        # ESignProvider port (+ hosted-form capability: supportsHostedForms, hostedFormMint)
│       │   ├── registry.ts        # providerFromEnv + defaultRegistry: ESIGN_PROVIDER → adapter, lazily
│       │   ├── store.ts           # EnvelopeStore port + in-memory implementation
│       │   ├── handlers.ts        # Fetch-API mint + webhook handlers (serverless); MintTarget = provider | mint fn ⭐
│       │   ├── signingPage.ts     # Signing-page CSP + nonce; signingPageResponse (Fetch); signingPageExpress.ts is its Express spelling
│       │   ├── graphql.ts         # SDL + resolvers factory (createESignGraphQL)
│       │   ├── pages.ts           # Mock signing page + the neutral mock-form renderer (renderMockFormPage)
│       │   ├── bridge/script.ts   # postMessage helper the pages ship + CLIENT_EVENTS, run in tests ⭐
│       │   ├── html.ts            # escapeHtml / sanitizeId / jsonForScript
│       │   ├── auth.ts            # bearerToken: the Authorization header → token (the meaning stays the host's)
│       │   ├── hmac.ts / validation.ts / audit.ts / errors.ts / log.ts / tracing.ts / http.ts
│       │   ├── prefill.ts / bridgeScript.ts  # deprecated shims over docusign/ and bridge/
│       │   ├── docusign/          # DocuSign adapter: auth (JWT grant), client, config, webforms, provider,
│       │   │                      #   types (prefill contract), prefill, bridge (return-URL page), mockWebFormPage,
│       │   │                      #   handlers (mintFromDocuSign), express (mountDocuSignPages), index (barrel)
│       │   ├── mock/              # Mock adapter (mirrors DocuSign locally)
│       │   └── __tests__/         # Jest, 100% enforced
│       ├── tsup.config.ts         # ESM + CJS + d.ts build (four entries: index, express, knex, docusign)
│       └── dist/                  # Build output (gitignored)
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
│       │   ├── useESignature.ts   # Headless hook: runs core's signing machine (NetInfo, WebView transport, embed) ⭐
│       │   ├── ESignature.tsx     # Default UI over the hook (source-driven) ⭐
│       │   ├── theme.ts           # Base styles/copy + theme/styles/labels resolvers
│       │   ├── types.ts           # Props/hook/theme/status/error types
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
│       │   ├── useESignature.ts   #   Headless hook (embed: iframe | mount)
│       │   ├── ESignature.tsx     #   Default UI over the hook
│       │   ├── theme.ts           #   Base styles/copy + theme/styles/labels resolvers
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
│       ├── vite.config.ts         # Vite + vitest; lib from source when serving, dist when building
│       └── vite/libraries.ts      # requireBuiltLibraries + sourceAliases, unit-tested ⭐
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
├── 🖥️ SERVER EXAMPLE 2 - one mutation on an existing API (the smallest footprint)
│   │
│   └── examples/mint-only-demo/
│       ├── src/
│       │   ├── quote.ts           # The host's own data → prefill of the read-only fields
│       │   ├── mint.ts            # hostedFormMint(providerFromEnv(...)): DocuSign or the mock by ESIGN_PROVIDER
│       │   ├── schema.ts          # The host's schema with investSigningUrl added
│       │   ├── server.ts          # Apollo Server + the host's session in the context
│       │   └── index.ts           # Bootstrap (PORT, default 4100)
│       └── tests/                 # Vitest, 100% enforced
│
├── 🖥️ SERVER EXAMPLE 3 - the Fetch handlers behind a route
│   │
│   └── examples/serverless-handler-demo/
│       ├── src/
│       │   ├── handlers.ts        # createWebFormInstanceHandler + createWebhookHandler over providerFromEnv(defaultRegistry)
│       │   ├── node.ts            # IncomingMessage ⇄ Request/Response adapter + route table
│       │   └── index.ts           # Bootstrap (PORT, default 4200)
│       └── tests/                 # Vitest, 100% enforced
│
├── 🖥️ SERVER EXAMPLE 1 - the whole service (Express + Apollo + Postgres)
│   │
│   └── examples/full-service-demo/
│       ├── package.json           # Backend dependencies
│       ├── tsconfig.json          # TypeScript configuration
│       ├── biome.json             # Biome lint + format configuration
│       ├── vitest.config.ts       # Unit test config (with coverage)
│       ├── vitest.e2e.config.ts   # E2E test config (sequential)
│       ├── .env.example           # Documented environment variables
│       ├── .env.docusign.example  # The live DocuSign layout, dummy values (make docusign-env writes the real one)
│       ├── .env.test              # Test database connection (tracked)
│       │
│       ├── src/
│       │   ├── index.ts           # Bootstrap (dotenv + startServer)
│       │   ├── server.ts          # startServer(port) - testable ⭐
│       │   ├── app.ts             # Express + Apollo; mounts the package's router ⭐
│       │   ├── schema.ts          # createESignGraphQL over the envelope service ⭐
│       │   ├── typeDefs.ts        # Re-exports the package SDL (schema.graphql source)
│       │   ├── services.ts        # Composition: createEnvelopeService(provider, store) ⭐
│       │   ├── store.ts           # The package's Knex EnvelopeStore over db.ts
│       │   ├── migrate.ts         # Applies the package's migrations (dist/migrate.js in the image)
│       │   ├── db.ts              # Knex instance (fail-fast)
│       │   ├── auth.ts            # JWT verification (HS256)
│       │   ├── config.ts          # Boot-time security validation (fail-closed)
│       │   ├── tracing.ts         # OTel spans for the service + providers
│       │   │
│       │   ├── providers/         # The package's adapters wired to this service ⭐
│       │   │   ├── port.ts        #   Re-exports ESignProvider + supportsWebForms
│       │   │   ├── index.ts       #   registry + providerFromEnv, singleton (tracing-wrapped)
│       │   │   ├── mock.ts        #   mock adapter handle (pages served by the router)
│       │   │   └── docusign/      #   DocuSign adapter handle + env config
│       │   │
│       │   ├── errors.ts          # Re-exports the package's coded errors
│       │   ├── types.ts           # Re-exports the domain types + GraphQLContext
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
│   │                              # packages/, examples/ have fan-out
│   │                              # Makefiles; each workspace a local one
│   ├── scripts/                   # the `tooling` npm workspace; pure logic in scripts/lib/*.mjs, Vitest-covered at 100% ⭐
│   │   ├── {ci,e2e,release}/ , assemble-diagrams.mjs , coverage-badge.mjs , status-badge.mjs
│   │   │   └── release/resolve-version.mjs  # thin CLI over scripts/lib/resolve-version.mjs
│   │   ├── lib/*.mjs              # extracted, unit-tested logic behind the CLI entry scripts (semver, resolve-version, badge)
│   │   └── __tests__/*.test.mjs   # shell-script tests (changed-class.sh, docs-freshness.sh) - shell out, not V8-covered
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
| `examples/full-service-demo/src/app.ts` | Server factory |
| `examples/full-service-demo/src/schema.ts` | GraphQL API |
| `examples/full-service-demo/src/webhook.ts` | Generic webhook processing |
| `examples/full-service-demo/src/types.ts` | ESignProvider interface |
| `examples/full-service-demo/src/providers/index.ts` | Provider registry (providerFromEnv) + singleton |
| `packages/esign-server/src/knex/migrations.ts` | Database schema (programmatic Knex migration source) |
| `examples/full-service-demo/tests/e2e/` | E2E tests |

## Integration Points

How the parts communicate (GraphQL, webhooks, WebView events, database):
see [integration.md](integration.md). Per-part
entry points are listed in each architecture doc.
