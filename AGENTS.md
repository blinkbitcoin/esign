# AGENTS.md

Instructions for AI agents working with this codebase.

## Project Overview

E-signature integration monorepo (npm workspaces): a backend GraphQL service,
a platform-agnostic core package, publishable React Native and React web
libraries, and one demo app per platform for manual and E2E testing.

- **Language**: TypeScript 6.0 everywhere
- **Node**: `^22.22.2 || >= 24.15.0`; toolchain pinned by `flake.nix`, entered
  via direnv (`direnv allow . && direnv allow examples/full-service-demo`, once per machine)
- **Docs**: `docs/index.md` is the current-state entry point; CLAUDE.md has
  the full command reference; `CONTRIBUTING.md` has the commit and release rules

## Project Structure

```
├── packages/
│   ├── esign-core/              # 📦 shared core: SigningSource abstraction, Apollo factory, GraphQL codegen
│   ├── esign-server/            # 📦 server side: DocuSign client, createWebFormInstance, envelope domain over provider + store ports
│   ├── esign-react-native/      # 📦 THE PRODUCT - RN (`ESignature` + `useESignature` over a WebView)
│   └── esign-react/             # 📦 THE PRODUCT - web (`ESignature` + `useESignature` over an iframe)
├── examples/
│   ├── react-native-demo/       # 📱 RN integration demo (Maestro E2E)
│   ├── react-demo/              # 🌐 Web integration demo (Vite, Playwright E2E)
│   ├── full-service-demo/       # 🖥️ server shape 1: the whole service (Express 5 + Apollo 5 + Knex/Postgres), the E2E backend, the esign-api image
│   ├── mint-only-demo/          # 🖥️ server shape 2: an existing GraphQL API adds one mint mutation (the Blink API shape)
│   └── serverless-handler-demo/ # 🖥️ server shape 3: the Fetch handlers behind a route handler
├── docs/                        # Current-state documentation (hand-maintained)
├── scripts/                     # the `tooling` npm workspace: ci/, e2e/, release/ shell + node used by the Makefile and CI; lib/*.mjs is Vitest-covered at 100%, __tests__/ covers the shell scripts
├── Makefile                     # Root flows; packages/, examples/ and each workspace have their own
└── package.json                 # Workspace root (orchestration scripts, single lockfile)
```

## Commands (repo root)

Prefer the Makefile (house convention): `make help` lists every target with a
one-line description. The ones you will reach for:

| Target | Description |
|--------|-------------|
| `make install` | `npm ci` across all workspaces (also installs the git hooks) |
| `make test` | Unit suites + `check-code` (lint, typecheck, format check) |
| `make coverage` | Coverage - 100% enforced on the packages, the backend, and `scripts/lib` |
| `make check-ci` | actionlint on the workflows + shellcheck on `scripts/**` |
| `make codeql` | GitHub's CodeQL analysis locally (same config as `codeql.yml`, markers honoured);<br>never run in CI - GitHub runs it there |
| `make codegen` | Regenerate `schema.graphql` + client types after editing the SDL in `packages/esign-server/src/graphql.ts` |
| `make diagrams` | Re-render `docs/diagrams/dist/*.svg` from `src/*.mmd` (CI fails on drift) |
| `make docs-check` | Warn when architecture-relevant changes ship without a `docs/` update;<br>fail on a README table cell line wider than 72 characters (break with `<br>`) |
| `make coverage` | 100% enforced everywhere; also fails on a coverage row with nothing to<br>cover (re-export / type-only modules go in the workspace's exclude list) |
| `make db-up migrate backend` | Dev Postgres, migrations, backend dev server |
| `make e2e-backend` / `make e2e-web` | Backend E2E against real Postgres / Playwright browser E2E |
| `make e2e-android-local` / `make e2e-ios-local` | The whole mobile stack on a laptop (DB, backend, APK or .app, Metro, Maestro,<br>teardown); Android needs a running emulator, iOS boots a simulator.<br>`e2e-backend-up` / `android-build` or `ios-build` / `e2e-metro-up` /<br>`e2e-android` or `e2e-ios` are the steps CI runs as separate jobs |
| `make start` / `make ios` / `make android` / `make web` | Demo apps |
| `make release` | Merge the open release PR that release-please maintains (tags, publishes; `docs/releasing.md`) |

Underlying npm scripts (`npm test`, `npm run typecheck`, `npm run lint`,
`npm run build`, ...) are listed in CLAUDE.md.

## Rules of the Road

- Do all branch work in a git worktree (`git worktree add ../esign-<topic> -b <branch> origin/main`),
  never by switching branches in the main clone: several agent sessions share
  that checkout, and a commit made there lands on whatever branch another
  session left checked out
- Commit messages and PR titles are Conventional Commits with an allowed
  scope list (`core`, `server`, `rn`, `react`, `demo`, `e2e`, `ci`, `deps`,
  `deps-dev`, `docs`, `release`; source of truth `commitlint.config.mjs`).
  Squash merges take the PR title, so name the PR like a commit
- Change code **and the relevant doc in the same change**; `docs/` is
  hand-maintained and CI's Docs check flags architecture changes without one
  (a `package.json` counts only when the change is structural - exports,
  scripts, workspaces - not a dependency bump; Dependabot PRs are exempt)
- Shell that CI or the Makefile runs lives in `scripts/{ci,e2e,release}/`,
  not inline in workflows; it is shellcheck'd by `make check-ci`
- Every service listens on `ESIGN_PORT_BASE` (default 4100 - 4000 is
  everybody's) plus its offset: the backend +0, the web demo +1/+2/+3 (proxy /
  webform / publicurl), mint-only +4, serverless +5, the live service and its
  two examples +6/+7/+8, the docker smoke +9. The table is
  `scripts/lib/ports.mjs`; shell reads it through `scripts/e2e/ports-env.sh`
  (`$ESIGN_API_PORT`, `$MINT_PORT`, `$LIVE_PORT`, ...), the Playwright
  configs through `examples/react-demo/e2e/ports.ts`, and each service
  declares its own offset (its test checks the literal against the table).
  A second worktree sets one variable (`ESIGN_PORT_BASE=4300 make e2e-web`);
  a service's own variable (`PORT`, `LIVE_PORT`, ...) overrides just that
  service. Nothing hard-codes a port outside those defaults
- The `ESignProvider` port is the provider boundary - nothing provider-specific
  outside a `providers/<name>/` directory: `packages/esign-server/src/providers/docusign/`,
  `packages/esign-core/src/providers/docusign/`, `packages/esign-react/src/providers/docusign/`
  and `examples/full-service-demo/src/providers/docusign/`; a package's
  `src/docusign.ts` is a one-line re-export of its `providers/docusign/`
  surface (guard tests); generic layers never
  import a provider (guard tests), and providers are selected through
  `providerFromEnv` (`ESIGN_PROVIDER`)
- GraphQL error codes are a wire contract: the `ErrorCode` enum in
  `examples/full-service-demo/schema.graphql` (emitted from `src/typeDefs.ts`) and the generated
  client types in `packages/esign-core/src/generated/` - run `make codegen`
  after schema changes; drift fails tests and a CI step
- The libraries take no URLs/tokens/platform detection - host apps inject via
  a `SigningSource` (`createProxySigningSource` / `createWebFormsSource` /
  `createPublicUrlSource`) from `@blinkbitcoin/esign-core`; demo wiring lives in
  `examples/*/src/`. `ESignature` is provider-agnostic - adding a provider is a
  new `SigningSource`, the component never changes
- `graphql` stays on 16.x repo-wide (Apollo Server 5 peer range)
- A CodeQL false positive is suppressed where it sits: a
  `// codeql[<rule-id>]` comment alone on the line above the flagged line
  (`.github/codeql/codeql-config.yml` runs the pack's AlertSuppression
  query, without which the marker is ignored). Never dismiss it in the
  UI/API (fingerprint-keyed: the same finding re-opened three times across
  file moves) and never exclude the query (it stays on for real findings).
  `make codeql` runs the same analysis locally and shows the marker as
  suppressed before the push
- The git hooks (lefthook) run format, lint, commitlint and typecheck; CI is
  the authoritative gate and every workflow must be green before merge

## CI

One pipeline per branch (`ci.yml`): Checks → Unit → E2E (incl. the one build
of the packages, which Web tests, and the one build of the service image,
smoked) → Badges, then Publish (ships that build: packages to GitHub
Packages, image to GHCR) + Verify on `main`. Docs-only PRs stop after Checks. The iOS E2E
suite runs by default (GitHub-hosted macOS is free on a public repo); repo
variable `E2E_IOS=false` pauses it and PR label `e2e:ios` forces it for one PR
while paused. Live DocuSign E2E is opt-in (`E2E_LIVE=true` / label
`e2e:live`, secrets in the `docusign-demo` environment;
`docs/operations/live-e2e-ci.md`). Native E2E builds are cached on the inputs
`scripts/native-deps-hash.sh` sees; bump the key's `v` suffix when an input it
cannot see changes.

## Testing

- Core / RN / web library tests: `packages/*/src/__tests__/`
- Demo tests: `examples/react-native-demo/{__tests__,src/__tests__}/`,
  `examples/react-demo/src/__tests__/`; browser E2E in `examples/react-demo/e2e/` (Playwright)
- Backend unit tests: `examples/full-service-demo/tests/` (DB mocked); E2E: `examples/full-service-demo/tests/e2e/`
  (real Postgres via `docker-compose.test.yml`); `tests/live/` runs only with
  real DocuSign credentials (`make test-live`)
- Tooling scripts: `scripts/lib/*.test.mjs` (100% Vitest coverage) for the
  extracted logic; `scripts/__tests__/*.test.mjs` shells out to the shell
  scripts themselves; CLI entry points are excluded from coverage by design
- Mobile E2E: Maestro flows in `examples/react-native-demo/.maestro/`, driven by `scripts/e2e/*`
- Native-module mocks live in `packages/esign-react-native/__mocks__/` and are shared by the demo
- **Tests are silent.** Every workspace's `jest.setup.ts` / `vitest.setup.ts`
  fails a test that lets `console.error`, `console.warn` or `console.log`
  fire. Two things cause it, and both are bugs in the test: a module built
  without an injected logger (pass `silentLogger` / `spyLogger()` from
  `packages/esign-server/src/__tests__/support.ts`, or the `logger` option of
  `createESignApolloClient` / `useESignature` / the demos' factories - every
  logger in this repo is injectable), and a React state update outside
  `act()`. Anything that updates React state in a test goes through an
  act-wrapped API: Testing Library's `fireEvent` / `userEvent` / `waitFor` /
  `findBy*`, or `ReactTestRenderer.act` (async when the update is), never a
  raw DOM `.click()` or an awaited promise outside `act`. A test that expects
  logging spies on the console method itself
  (`jest.spyOn(console, 'warn').mockImplementation(() => {})`) in the test or
  a `beforeEach` - never `beforeAll`, which sits underneath the gate's spy -
  and thereby opts out for that test

## Troubleshooting

- **Metro cache**: `npm start -- --reset-cache`
- **Stale watchman** (after moving files): `watchman watch-del . && watchman watch-project .`
- **Clean Android build**: `cd examples/react-native-demo/android && ./gradlew clean`
- **Clean iOS build**: `cd examples/react-native-demo/ios && xcodebuild clean`
- **Reinstall deps**: `make reset` (root lockfile only)
