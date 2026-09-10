# Source Tree Analysis

**Project:** @blinkbitcoin/esign-react-native monorepo (npm workspaces)
**Updated:** 2026-09-10

## Repository Structure

```
esign/
│
├── 🧩 SHARED CORE (platform-agnostic)
│   │
│   └── packages/esign-core/
│       ├── src/
│       │   ├── index.ts           # Full entry (incl. Apollo factory) ⭐
│       │   ├── docusign.ts        # The DocuSign entry (./docusign): one line over providers/docusign/entry.ts ⭐
│       │   ├── webform.ts         # Alias of ./docusign (./webform) ⭐
│       │   ├── signing/           # SigningSource abstraction + machine.ts (the state machine) + labels.ts
│       │   │   ├── bridge.ts      #   interpretBridgeEvent: the neutral `{ event }` protocol the bridge/mock pages post
│       │   │   ├── hostedForm/    #   provider-neutral hosted-form source, minter, public-URL source (interpreter injectable)
│       │   │   └── ...            #   proxySource (Apollo) + deprecated shims at the old DocuSign paths
│       │   ├── providers/docusign/# DocuSign: interpretDocuSignEvent, the prefill contract, the Web Forms sources;
│       │   │                      #   entry.ts is the ./docusign surface (provider + the neutral layer), Apollo-free
│       │   ├── client.ts          # createESignApolloClient + ErrorCodes
│       │   ├── operations.ts      # GraphQL mutations (wire contract)
│       │   ├── generated/         # Codegen output (from packages/esign-service schema)
│       │   └── __tests__/         # incl. the webform-entry Apollo-free guard + the signing/ ↛ providers/ guard
│       ├── codegen.ts             # GraphQL Codegen config
│       └── dist/                  # tsup output (gitignored)
│
├── 🖥️ SERVER LIBRARY (Node-only; the backend is built on it)
│   │
│   └── packages/esign-node/
│       ├── src/
│       │   ├── index.ts           # Public API: client, domain, handlers, prefill ⭐
│       │   ├── express.ts         # ./express entry: createESignRouter + createHostedFormRouter (mint-only preset), pages via signingPage.ts (express is a peer) ⭐
│       │   ├── knex.ts            # ./knex entry: Knex EnvelopeStore + migration source (knex is a peer) ⭐
│       │   ├── docusign.ts        # ./docusign entry: the DocuSign adapter on its own (peer-free) ⭐
│       │   ├── knex/              #   store.ts, migrations.ts (ESIGN_MIGRATIONS, programmatic source)
│       │   ├── envelopes.ts       # createEnvelopeService: rules, audit, webhook state machine ⭐
│       │   ├── provider.ts        # ESignProvider port (+ hosted-form capability: supportsHostedForms, hostedFormMint)
│       │   ├── registry.ts        # providerFromEnv + defaultRegistry (boot checks) + hostedFormProviderFromEnv: ESIGN_PROVIDER → adapter, lazily
│       │   ├── production.ts      # ESIGN_ENV=production guard: productionErrors / assertProductionConfig (provider-agnostic, never NODE_ENV)
│       │   ├── store.ts           # EnvelopeStore port + in-memory implementation
│       │   ├── handlers.ts        # Fetch-API mint + webhook handlers + createHostedFormApp (the whole mint-only surface); MintTarget = provider | mint fn ⭐
│       │   ├── signingPage.ts     # Signing-page CSP + nonce; signingPageResponse (Fetch); signingPageExpress.ts is its Express spelling
│       │   ├── graphql.ts         # SDL + resolvers factory (createESignGraphQL)
│       │   ├── pages.ts           # Mock signing page + the neutral mock-form renderer (renderMockFormPage)
│       │   ├── bridge/script.ts   # postMessage helper the pages ship + CLIENT_EVENTS, run in tests ⭐
│       │   ├── html.ts            # escapeHtml / sanitizeId / jsonForScript
│       │   ├── auth.ts            # bearerToken: the Authorization header → token (the meaning stays the host's)
│       │   ├── hmac.ts / validation.ts / audit.ts / errors.ts / log.ts / tracing.ts / http.ts
│       │   ├── prefill.ts / bridgeScript.ts  # deprecated shims over providers/docusign/ and bridge/
│       │   ├── providers/         # One directory per adapter of the ESignProvider port (guard test) ⭐
│       │   │   ├── docusign/      #   auth (JWT grant), client, config, webforms, provider, types (prefill
│       │   │   │                  #   contract), prefill, bridge (return-URL page), mockWebFormPage,
│       │   │   │                  #   handlers (mintFromDocuSign), express (mountDocuSignPages), index (barrel)
│       │   │   └── mock/          #   Mock adapter (mirrors DocuSign locally)
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
│       │   ├── docusign.ts        # The DocuSign entry (./docusign subpath): one line over providers/docusign/entry.ts ⭐
│       │   ├── webform.ts         # Alias of ./docusign (./webform subpath) ⭐
│       │   ├── providers/docusign/entry.ts  # The ./docusign surface: core's /docusign + the component and hook, Apollo-free
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
│       │   ├── docusign.ts        #   The DocuSign entry (./docusign subpath): one line over providers/docusign/entry.ts ⭐
│       │   ├── providers/docusign/#   DocuSign.js SDK source (web-only) + entry.ts, the ./docusign surface;
│       │   │                      #   docusignWebForms.ts is the source's deprecated shim
│       │   └── types.ts
│       ├── tsup.config.ts         # ESM + CJS + d.ts build
│       └── dist/                  # Build output (gitignored)
│
├── 🌐 WEB EXAMPLE APP
│   │
│   └── examples/react-demo/
│       ├── index.html / src/main.tsx
│       ├── src/App.tsx            # Host wiring around the web component
│       ├── src/apollo.ts          # createESignApolloClient({uri, getAuthToken, logger})
│       ├── vite.config.ts         # Vite + vitest; lib from source when serving, dist when building
│       └── vite/libraries.ts      # requireBuiltLibraries + sourceAliases, unit-tested ⭐
│
├── 📱 EXAMPLE APP (integration / E2E host)
│   │
│   └── examples/react-native-demo/
│       ├── App.tsx                # Demo wiring: ApolloProvider + handlers
│       ├── index.js / app.json    # App registration
│       ├── src/
│       │   ├── apollo.ts          # createESignApolloClient({uri, getAuthToken, logger})
│       │   └── config.ts          # Platform-aware backend URL
│       ├── __tests__/ __mocks__/  # App tests + safe-area mock
│       ├── ios/  android/         # Native projects (node-resolved RN paths)
│       ├── .maestro/              # Mobile E2E flows
│       ├── metro.config.js        # watchFolders -> workspace root
│       └── Gemfile / .bundle/     # CocoaPods tooling
│
├── 🖥️ SERVER EXAMPLE 1 - one mutation on an existing API (the smallest footprint)
│   │
│   └── examples/mint-only-demo/
│       ├── src/
│       │   ├── quote.ts           # The host's own data → prefill of the read-only fields
│       │   ├── mint.ts            # hostedFormMint(providerFromEnv(...)): DocuSign or the mock by ESIGN_PROVIDER
│       │   ├── schema.ts          # The host's schema with investSigningUrl added
│       │   ├── server.ts          # Apollo Server + the host's session in the context
│       │   └── index.ts           # Bootstrap (PORT, default ESIGN_PORT_BASE + 4 = 4104)
│       ├── tsup.config.ts         # Bundles src/ to dist/ for the image
│       ├── Dockerfile             # The demo image CI builds and smokes (never published)
│       └── tests/                 # Vitest, 100% enforced
│
├── 🖥️ SERVER EXAMPLE 2 - the Fetch handlers behind a route
│   │
│   └── examples/serverless-handler-demo/
│       ├── src/
│       │   ├── handlers.ts        # createWebFormInstanceHandler + createWebhookHandler over providerFromEnv(defaultRegistry)
│       │   ├── node.ts            # IncomingMessage ⇄ Request/Response adapter + route table
│       │   └── index.ts           # Bootstrap (PORT, default ESIGN_PORT_BASE + 5 = 4105)
│       └── tests/                 # Vitest, 100% enforced
│
├── 📦 PACKAGE - the whole service, published (Fetch core; mint always, envelopes with DATABASE_URL)
│   │
│   └── packages/esign-service/
│       ├── package.json           # Backend dependencies
│       ├── tsconfig.json          # TypeScript configuration
│       ├── biome.json             # Biome lint + format configuration
│       ├── vitest.config.mts      # Unit test config (with coverage)
│       ├── vitest.e2e.config.mts  # E2E test config (sequential)
│       ├── .env.example           # Documented environment variables
│       ├── .env.docusign.example  # The live DocuSign layout, dummy values (make docusign-env writes the real one)
│       ├── .env.test              # Test database connection (tracked)
│       │
│       ├── src/
│       │   ├── index.ts           # The library entry (.): createESignApp + the pure pieces
│       │   ├── node.ts            # The process entry point: dotenv → telemetry → serve | migrate ⭐
│       │   ├── server.ts          # ./node: startServer(env, deps) over @hono/node-server ⭐
│       │   ├── vercel.ts          # ./vercel: GET/POST/OPTIONS route handlers
│       │   ├── cloudflare.ts      # ./cloudflare: the Worker default export (mint only)
│       │   ├── app.ts             # The Fetch core (createESignApp): capabilities → routes ⭐
│       │   ├── capabilities.ts    # What the environment turns on (pure) ⭐
│       │   ├── session.ts         # Session verification: JWKS or HS256, via jose
│       │   ├── terms.ts           # The TERMS_URL callback and its merge rule
│       │   ├── envelopes.ts       # The envelope capability: Fetch webhook + Apollo (Node-only)
│       │   ├── loadEnvelopes.ts   # The one place that names ./envelopes (Node targets only)
│       │   ├── schema.ts          # createGraphQL over the envelope service ⭐
│       │   ├── typeDefs.ts        # Re-exports the package SDL (schema.graphql source)
│       │   ├── services.ts        # Composition: createEnvelopeService(provider, store) ⭐
│       │   ├── store.ts           # The package's Knex EnvelopeStore over db.ts
│       │   ├── migrate.ts         # Applies the package's migrations (node dist/node.js migrate)
│       │   ├── db.ts              # Knex instance (fail-fast)
│       │   ├── env.ts             # The Env type + ALLOW_INSECURE_DEV
│       │   ├── proxy.ts           # TRUST_PROXY: whether x-forwarded-for names the client
│       │   ├── port.ts            # PORT / ESIGN_PORT_BASE resolution
│       │   ├── config.ts          # The boot guard: validateConfig(env, { runtime }), pure ⭐
│       │   ├── instrumentation.ts # OpenTelemetry init (before the app loads)
│       │   ├── tracing.ts         # OTel spans for the service + providers
│       │   │
│       │   ├── providers/         # The package's adapters wired to this service ⭐
│       │   │   ├── port.ts        #   Re-exports ESignProvider + supportsHostedForms
│       │   │   ├── index.ts       #   selectProvider(env): registry + providerFromEnv, tracing-wrapped, per app
│       │   │   ├── mock.ts        #   mock adapter handle
│       │   │   ├── pages.ts       #   The mock provider's signing pages as Fetch responses
│       │   │   └── docusign/      #   DocuSign adapter handle + env config
│       │   │
│       │   ├── errors.ts          # Re-exports the package's coded errors
│       │   ├── types.ts           # Re-exports the domain types + GraphQLContext
│       │   │
│       │   └── __mocks__/
│       │       └── db.ts          # knex-mock-client for unit tests
│       │
│       ├── Dockerfile             # The esign-service image (defaults ESIGN_ENV=production)
│       ├── deploy/                # Deploy templates: compose, k8s, nix, vercel, cloudflare
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
│   │   │   ├── release/resolve-version.mjs  # thin CLI over scripts/lib/resolve-version.mjs
│   │   │   └── ci/manifest-structural.mjs   # thin CLI over scripts/lib/manifest-structural.mjs (docs-freshness.sh)
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
│           ├── ci.yml             # The one pipeline per branch (calls the reusable ones)
│           ├── checks.yml         # Changes, Code, Commits, Docs (static)
│           ├── test.yml           # Unit suites + coverage
│           ├── e2e.yml            # Build Packages → Web, Docker, Backend, Android, iOS
│           ├── release.yml        # release-please + the publish retry
│           ├── pull-request.yml   # PR title lint
│           └── codeql.yml         # CodeQL analysis (informational)
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
| `packages/esign-core/src/client.ts` | Apollo factory + error-code contract |

### Demo Critical Paths

| Path | Purpose |
|------|---------|
| `examples/react-native-demo/App.tsx` | Host wiring: provider + callbacks |
| `examples/react-native-demo/src/config.ts` | Platform-aware backend URL |
| `examples/react-native-demo/.maestro/` | E2E test flows |

### Backend Critical Paths

| Path | Purpose |
|------|---------|
| `packages/esign-service/src/app.ts` | The Fetch core (`createESignApp`) |
| `packages/esign-service/src/capabilities.ts` | What the environment turns on |
| `packages/esign-service/src/config.ts` | The boot guard (`validateConfig`) |
| `packages/esign-service/src/schema.ts` | GraphQL API |
| `packages/esign-service/src/envelopes.ts` | The envelope capability: webhook + GraphQL |
| `packages/esign-service/src/providers/port.ts` | `ESignProvider` interface (the provider boundary) |
| `packages/esign-service/src/providers/index.ts` | Provider selection per app (`selectProvider`, `providerFromEnv`) |
| `packages/esign-node/src/knex/migrations.ts` | Database schema (programmatic Knex migration source) |
| `packages/esign-service/tests/e2e/` | E2E tests |

## Integration Points

How the parts communicate (GraphQL, webhooks, WebView events, database):
see [integration.md](integration.md). Per-part
entry points are listed in each architecture doc.
