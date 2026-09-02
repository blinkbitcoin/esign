# Contributing

## Setup

```sh
make install                             # npm ci (also installs git hooks via lefthook)
direnv allow . && direnv allow apps/api  # once per machine: env + nix dev shell (Node 24)
```

Working on the libraries needs nothing else. Running the demo apps needs the
backend: see [Development in the README](README.md#development). Full setup,
environment variables, and troubleshooting:
[docs/development-guide.md](docs/development-guide.md).

## Quality gates

- `make test` — unit suites + lint + typecheck + format check. Coverage is
  **100% enforced** on the packages and backend; the demo apps have floors.
  The README coverage badge is measured, not hardcoded: every CI run
  aggregates the packages + backend line coverage and publishes it to
  `gh-pages/badges/<branch>/`; the README embeds the `main` one. A red
  `failing` badge replaces it when the coverage run fails. The same run
  uploads a combined HTML report as the `coverage-report` artifact (click
  the badge, open the latest run). `make coverage-badge` renders both
  locally into `coverage/badge/` and `coverage/report/`. The Unit and E2E
  badges next to it are rendered the same way from the pipeline's job
  results (`scripts/status-badge.mjs`).
- Git hooks (see [below](#git-hooks)) format, lint, and check the commit
  message locally.
- CI (`ci.yml`) is one pipeline for every branch: unit suites with
  coverage thresholds, all end-to-end suites (backend, browser, iOS
  simulator, Android emulator), and on `main` the publish + registry
  smoke. A second workflow re-checks the commit convention on the PR's
  commits and title.

## Commit messages

Commits follow [Conventional Commits](https://www.conventionalcommits.org):

```text
<type>(<scope>): <imperative summary>

[optional body - what and why, wrapped at 100 columns]

[optional footer - BREAKING CHANGE: ..., Closes #123]
```

| Type | Use for |
|------|---------|
| `feat` | A user-facing capability in a package or the backend |
| `fix` | A bug fix |
| `perf` | A performance improvement with no behavior change |
| `refactor` | Code change that neither fixes a bug nor adds a feature |
| `test` | Adding or correcting tests only |
| `docs` | Documentation only (READMEs, `docs/`, diagrams) |
| `build` | Build system, packaging, dependencies of the build itself |
| `ci` | GitHub Actions workflows and CI tooling |
| `chore` | Maintenance that touches none of the above (deps, tooling config) |
| `style` | Formatting only, no logic change |
| `revert` | Reverts a previous commit |

Scopes are optional but, when present, must be one of the workspace and
area names (`commitlint.config.mjs` is the source of truth):

| Scope | Covers |
|-------|--------|
| `core` | `packages/esign-core` |
| `rn` | `packages/esign-react-native` |
| `react` | `packages/esign-react` |
| `api` | `apps/api` |
| `demo` | `examples/*` |
| `e2e` | Maestro / Playwright / backend E2E suites |
| `ci` | `.github/` |
| `deps`, `deps-dev` | Dependency bumps (Dependabot uses these) |
| `docs` | `docs/` when the type is not already `docs` |
| `release` | Release tooling (workflow, notes config) |

Examples:

```text
feat(rn): expose onLoadStart on ESignature
fix(api): reject webhook replays that downgrade a terminal envelope
docs: add hero diagram and badges to the README
ci(e2e): retry the Maestro suite once on the driver relaunch race
```

Breaking changes get a `!` after the type/scope (`feat(core)!: ...`) and a
`BREAKING CHANGE:` footer explaining the migration.

**Where it is enforced:** the `commit-msg` hook runs commitlint on every
local commit, and the `Checks / Commits` workflow re-checks the PR's commits
and its **title** on every push and title edit. The title matters because
squash merges use it as the commit on `main`, so name the PR the same way you
would name a commit.

## Git hooks

[lefthook](https://github.com/evilmartians/lefthook) installs the hooks on
`npm install` (via the `prepare` script). They are fast local gates only;
CI stays the authoritative check.

| Hook | What runs |
|------|-----------|
| `pre-commit` | Biome format (root) and Biome check (`apps/api`) on staged files, auto-fixes re-staged; ESLint on staged TS/TSX; diagram re-render when a `.mmd` source changes. Skipped during merge and rebase replays. |
| `commit-msg` | commitlint against `commitlint.config.mjs` |
| `pre-push` | Workspace-wide typecheck |
| `post-merge`, `post-checkout` | `npm ci` when `package-lock.json` changed, so hooks never run on a stale install |

Escape hatches, for the rare cases where they are warranted:

- `git commit --no-verify` skips `pre-commit` and `commit-msg` once.
- `LEFTHOOK=0 git push` skips every hook for that command.
- `lefthook-local.yml` (gitignored) overrides or disables individual
  commands for your machine only - see the lefthook docs for the format.

## Making changes

1. Branch from `main`; keep the PR focused on one change. Change code **and
   the relevant doc in the same change** (docs are hand-maintained;
   `docs/index.md` maps them).
2. Diagrams: edit `docs/diagrams/src/*.mmd`, then `make diagrams` (CI fails
   on drift). Schema: edit `apps/api/src/typeDefs.ts`, then `make codegen`.
3. Open a PR with a Conventional Commits title — every workflow must be
   green. The title is also the line the release notes will show.

## Releases

- **Prerelease** (`next` tag): automatic on every green push to `main`,
  versioned `<next patch after the latest tag>-pre.<run>.<sha>`.
- **Stable**: one step — `make release V=X.Y.Z` (wraps
  `gh release create vX.Y.Z --target main --generate-notes`). **The tag is
  the version**: CI stamps it into the three packages at publish time, so
  nothing is committed and `package.json` stays at `0.0.0-development`.
  The release notes, generated from PR titles (`.github/release.yml`), are
  the changelog. A tag with a prerelease part (`v1.0.0-rc.1`) ships under
  `next`. GitHub Packages never accepts the same version twice, so a failed
  release means fixing forward and cutting a new tag.
  A release ships only once the commit's push-to-`main` run is green: the
  release run waits for an in-flight main run and refuses a red one, and
  `release-retry.yml` re-runs the blocked Publish automatically when main
  turns green (re-run the flaky job with `gh run rerun <id> --failed`).
  So `make release` is fire-and-forget.
