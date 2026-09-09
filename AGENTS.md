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
| `make codegen` | Regenerate `schema.graphql` + client types after editing the SDL in `packages/esign-server/src/graphql.ts` |
| `make diagrams` | Re-render `docs/diagrams/dist/*.svg` from `src/*.mmd` (CI fails on drift) |
| `make docs-check` | Warn when architecture-relevant changes ship without a `docs/` update;<br>fail on a README table cell line wider than 72 characters (break with `<br>`) |
| `make db-up migrate backend` | Dev Postgres, migrations, backend dev server |
| `make e2e-backend` / `make e2e-web` | Backend E2E against real Postgres / Playwright browser E2E |
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
- Shell that CI or the Makefile runs lives in `scripts/{ci,e2e,release}/`,
  not inline in workflows; it is shellcheck'd by `make check-ci`
- The `ESignProvider` port is the provider boundary - nothing provider-specific
  outside a `providers/<name>/` directory: `packages/esign-server/src/docusign/`,
  `packages/esign-core/src/providers/docusign/`, `packages/esign-react/src/providers/docusign/`
  and `examples/full-service-demo/src/providers/docusign/`; generic layers never
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

## Troubleshooting

- **Metro cache**: `npm start -- --reset-cache`
- **Stale watchman** (after moving files): `watchman watch-del . && watchman watch-project .`
- **Clean Android build**: `cd examples/react-native-demo/android && ./gradlew clean`
- **Clean iOS build**: `cd examples/react-native-demo/ios && xcodebuild clean`
- **Reinstall deps**: `make reset` (root lockfile only)
