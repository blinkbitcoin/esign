# Contributing

## Setup

```sh
make install                             # npm ci (also installs git hooks via lefthook)
direnv allow . && direnv allow examples/full-service-demo  # once per machine: env + nix dev shell (Node 24)
```

Working on the libraries needs nothing else. Running the demo apps needs the
backend: see [Development in the README](README.md#development). Full setup,
environment variables, and troubleshooting:
[docs/development-guide.md](docs/development-guide.md).

## Quality gates

- `make test` — unit suites + lint + typecheck + format check. Coverage is
  **100% enforced** on the packages, the backend, and both demo apps.
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
- CI (`ci.yml`) is one pipeline for every branch: static checks, unit
  suites with coverage thresholds, then one build of the packages next to
  all end-to-end suites (backend, browser - over that build - iOS
  simulator, Android emulator) and a build + smoke of the service image, and
  on `main` the publish of those exact tarballs and image (GitHub Packages,
  GHCR) + registry smoke of both. A second workflow re-checks the commit
  convention on the PR's commits and title.

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
| `server` | `packages/esign-server` |
| `rn` | `packages/esign-react-native` |
| `react` | `packages/esign-react` |
| `api` | `examples/full-service-demo` |
| `demo` | `examples/*` |
| `e2e` | Maestro / Playwright / backend E2E suites |
| `ci` | `.github/` |
| `deps`, `deps-dev` | Dependency bumps (Dependabot uses these) |
| `docs` | `docs/` when the type is not already `docs` |
| `release` | Release tooling (release-please config and workflow); release-please's own PRs are `chore(release): X.Y.Z` |

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
local commit, and the `Checks / Commits` job in CI re-checks the PR's commits
and its **title** on every push and title edit. The title matters because
squash merges use it as the commit on `main`, so name the PR the same way you
would name a commit.

## Git hooks

[lefthook](https://github.com/evilmartians/lefthook) installs the hooks on
`npm install` (via the `prepare` script). They are fast local gates only;
CI stays the authoritative check.

| Hook | What runs |
|------|-----------|
| `pre-commit` | Biome format (root) and Biome check (`examples/full-service-demo`) on staged files, auto-fixes re-staged; ESLint on staged TS/TSX; diagram re-render when a `.mmd` source changes. Skipped during merge and rebase replays. |
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
   on drift). Schema: edit `examples/full-service-demo/src/typeDefs.ts`, then `make codegen`.
3. Open a PR with a Conventional Commits title — every workflow must be
   green. The title is the line `CHANGELOG.md` will show, and its type
   decides the version bump (`feat` → minor, `fix` → patch, `ci` / `docs` /
   `chore` → none), so a fix that only touches CI or the demos is `ci:` or
   `chore(demo):`, not `fix(ci):`.

## Releases

Full walkthrough with a worked example: [docs/releasing.md](docs/releasing.md).

- **Prerelease** (`next` tag): automatic on every green push to `main`,
  versioned `<next patch after the latest tag>-pre.<run>.<sha>`.
- **Stable**: merge the `chore(release): X.Y.Z` pull request. release-please
  opens it once a `feat` / `fix` / `perf` / `revert` commit reaches `main`
  and keeps it current: the inferred version, the `CHANGELOG.md` entry
  grouped by type (CI, docs and chores are left out), the root
  `package.json` version. Approve it and `make release` (or the Merge
  button). Merging tags `vX.Y.Z`, publishes the GitHub Release with that
  entry as its body, and starts the release run. **The tag is the version**:
  CI stamps it into the four packages before building them, so their
  `package.json` stays at `0.0.0-development`. GitHub Packages never
  accepts the same version twice, so a failed release means fixing forward.
  A release ships only once the commit's push-to-`main` run is green: the
  release run waits for an in-flight main run and refuses a red one, and
  the `Release` workflow's retry job re-runs the blocked Publish automatically when main
  turns green (re-run the flaky job with `gh run rerun <id> --failed`).
  So merging the release PR is fire-and-forget.
- **Release candidate**: `make release-rc V=X.Y.Z-rc.1` hand-cuts a
  prerelease-suffixed tag that ships under `next`.
