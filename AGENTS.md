# AGENTS.md

Instructions for AI agents working with this codebase.

## Project Overview

E-signature integration monorepo (npm workspaces): a backend GraphQL service,
a platform-agnostic core package, publishable React Native and React web
libraries, and one demo app per platform for manual and E2E testing.

- **Language**: TypeScript 6.0 everywhere
- **Node**: `^22.22.2 || >= 24.15.0`; toolchain pinned by `flake.nix`, entered
  via direnv (`direnv allow . && direnv allow apps/api`, once per machine)
- **Docs**: `docs/index.md` is the current-state entry point; CLAUDE.md has
  the full command reference; `CONTRIBUTING.md` has the commit and release rules

## Project Structure

```
├── apps/api/                    # 🖥️ THE SERVICE (Express 5 + Apollo 5 + Knex/Postgres)
├── packages/
│   ├── esign-core/              # 📦 shared core: SigningSource abstraction, Apollo factory, GraphQL codegen
│   ├── esign-react-native/      # 📦 THE PRODUCT - RN (`ESignature` over a WebView)
│   └── esign-react/             # 📦 THE PRODUCT - web (`ESignature` over an iframe)
├── examples/
│   ├── react-native-demo/       # 📱 RN integration demo (Maestro E2E)
│   └── react-demo/              # 🌐 Web integration demo (Vite, Playwright E2E)
├── docs/                        # Current-state documentation (hand-maintained)
├── scripts/                     # ci/, e2e/, release/ shell + node used by the Makefile and CI
├── Makefile                     # Root flows; apps/, packages/, examples/ and each workspace have their own
└── package.json                 # Workspace root (orchestration scripts, single lockfile)
```

## Commands (repo root)

Prefer the Makefile (house convention): `make help` lists every target with a
one-line description. The ones you will reach for:

| Target | Description |
|--------|-------------|
| `make install` | `npm ci` across all workspaces (also installs the git hooks) |
| `make test` | Unit suites + `check-code` (lint, typecheck, format check) |
| `make coverage` | Coverage - 100% enforced on the packages and the backend |
| `make check-ci` | actionlint on the workflows + shellcheck on `scripts/**` |
| `make codegen` | Regenerate `schema.graphql` + client types after editing `apps/api/src/typeDefs.ts` |
| `make diagrams` | Re-render `docs/diagrams/dist/*.svg` from `src/*.mmd` (CI fails on drift) |
| `make docs-check` | Warn when architecture-relevant changes ship without a `docs/` update |
| `make db-up migrate backend` | Dev Postgres, migrations, backend dev server |
| `make e2e-backend` / `make e2e-web` | Backend E2E against real Postgres / Playwright browser E2E |
| `make start` / `make ios` / `make android` / `make web` | Demo apps |
| `make release V=X.Y.Z` | Cut a stable release (the tag is the version; nothing is committed) |

Underlying npm scripts (`npm test`, `npm run typecheck`, `npm run lint`,
`npm run build`, ...) are listed in CLAUDE.md.

## Rules of the Road

- Do all branch work in a git worktree (`git worktree add ../esign-<topic> -b <branch> origin/main`),
  never by switching branches in the main clone: several agent sessions share
  that checkout, and a commit made there lands on whatever branch another
  session left checked out
- Commit messages and PR titles are Conventional Commits with an allowed
  scope list (`core`, `rn`, `react`, `api`, `demo`, `e2e`, `ci`, `deps`,
  `deps-dev`, `docs`, `release`; source of truth `commitlint.config.mjs`).
  Squash merges take the PR title, so name the PR like a commit
- Change code **and the relevant doc in the same change**; `docs/` is
  hand-maintained and CI's Docs check flags architecture changes without one
- Shell that CI or the Makefile runs lives in `scripts/{ci,e2e,release}/`,
  not inline in workflows; it is shellcheck'd by `make check-ci`
- The `ESignProvider` port (`apps/api/src/providers/port.ts`) is the provider
  boundary - nothing DocuSign-specific outside `apps/api/src/providers/docusign/`
- GraphQL error codes are a wire contract: the `ErrorCode` enum in
  `apps/api/schema.graphql` (emitted from `src/typeDefs.ts`) and the generated
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
of the packages, which Web tests) → Badges, then Publish (ships that build) +
Verify on `main`. Docs-only PRs stop after Checks. The iOS E2E
suite runs by default (GitHub-hosted macOS is free on a public repo); repo
variable `E2E_IOS=false` pauses it and PR label `e2e:ios` forces it for one PR
while paused. Native E2E builds are cached on the inputs
`scripts/native-deps-hash.sh` sees; bump the key's `v` suffix when an input it
cannot see changes.

## Testing

- Core / RN / web library tests: `packages/*/src/__tests__/`
- Demo tests: `examples/react-native-demo/{__tests__,src/__tests__}/`,
  `examples/react-demo/src/__tests__/`; browser E2E in `examples/react-demo/e2e/` (Playwright)
- Backend unit tests: `apps/api/tests/` (DB mocked); E2E: `apps/api/tests/e2e/`
  (real Postgres via `docker-compose.test.yml`); `tests/live/` runs only with
  real DocuSign credentials (`make test-live`)
- Mobile E2E: Maestro flows in `examples/react-native-demo/.maestro/`, driven by `scripts/e2e/*`
- Native-module mocks live in `packages/esign-react-native/__mocks__/` and are shared by the demo

## Troubleshooting

- **Metro cache**: `npm start -- --reset-cache`
- **Stale watchman** (after moving files): `watchman watch-del . && watchman watch-project .`
- **Clean Android build**: `cd examples/react-native-demo/android && ./gradlew clean`
- **Clean iOS build**: `cd examples/react-native-demo/ios && xcodebuild clean`
- **Reinstall deps**: `make reset` (root lockfile only)
