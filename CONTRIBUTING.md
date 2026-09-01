# Contributing

## Setup

```sh
make install                             # npm ci (also installs git hooks via lefthook)
direnv allow . && direnv allow apps/api  # once per machine: env + nix dev shell (Node 24)
```

Working on the libraries needs nothing else. Running the demo apps needs the
backend: see [Development in the README](README.md#development).

## Quality gates

- `make test` — unit suites + lint + typecheck + format check. Coverage is
  **100% enforced** on the packages and backend; the demo apps have floors.
- Pre-commit hooks format (Biome) and lint (ESLint) staged files; pre-push
  runs the workspace typecheck. `git commit --no-verify` skips once.
- CI runs everything on each push/PR, plus all end-to-end suites
  (backend, browser, iOS simulator, Android emulator).

## Making changes

1. Branch, change code **and the relevant doc in the same change** (docs are
   hand-maintained; `docs/index.md` maps them).
2. Diagrams: edit `docs/diagrams/src/*.mmd`, then `make diagrams` (CI fails
   on drift). Schema: edit `apps/api/src/typeDefs.ts`, then `make codegen`.
3. Add a changeset for anything touching the published packages:
   `npx changeset` (pick bump level, describe the change). The three
   packages version together.
4. Open a PR — every workflow must be green.

## Releases

- **Prerelease** (`next` tag): automatic on every green push to `main`.
- **Stable**: `npx changeset version` (bumps + changelog), commit, then
  publish a GitHub Release with tag `vX.Y.Z` matching the new version —
  the publish workflow verifies the match and ships to GitHub Packages.
