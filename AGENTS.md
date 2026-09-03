# AGENTS.md

Instructions for AI agents working with this codebase.

## Project Overview

E-signature integration monorepo (npm workspaces): a backend GraphQL service,
a publishable React Native library, and a demo app for integration/E2E testing.

- **Language**: TypeScript 6.0 everywhere
- **Node**: >= 22.11.0
- **Docs**: `docs/index.md` is the current-state entry point; CLAUDE.md has
  the full command reference

## Project Structure

```
├── apps/api/                          # 🖥️ THE SERVICE (Express + Apollo + Knex/Postgres)
├── packages/
│   ├── @blinkbitcoin/esign-react-native/     # 📦 THE PRODUCT - RN (publishable library)
│   └── @blinkbitcoin/esign-react/            # 📦 THE PRODUCT - web (same API, iframe-based)
├── examples/
│   ├── react-native-demo/           # 📱 RN integration demo (Maestro E2E)
│   └── react-demo/                  # 🌐 Web integration demo (Vite)
├── docs/                            # Current-state documentation
└── package.json                     # Workspace root (orchestration scripts)
```

## Commands (repo root)

Prefer the Makefile (house convention): `make help` lists targets -
`make test`, `make e2e-backend`, `make db-up migrate backend`, `make ios`.
Underlying npm scripts:

| Command | Description |
|---------|-------------|
| `npm test` | All suites: library (Jest), demo (Jest), backend (Vitest) |
| `npm run test:coverage` | Coverage - 100% is the enforced baseline |
| `npm run typecheck` | tsc across all workspaces |
| `npm run lint` / `npm run format` | ESLint + Biome |
| `npm run build` | Library build (react-native-builder-bob) |
| `npm start` / `npm run ios` / `npm run android` | Demo app |
| `npm run backend` | Backend dev server |

## Rules of the Road

- The `ESignProvider` interface (`apps/api/src/types.ts`) is the provider
  boundary - nothing DocuSign-specific outside `apps/api/src/docusign.ts`
- GraphQL error codes are a wire contract between `apps/api/src/errors.ts`
  and `packages/esign-react-native/src/client.ts` - change atomically
- The library takes no URLs/tokens/platform detection - host apps inject via
  a `SigningSource` (`createProxySigningSource` / `createWebFormsSource` /
  `createPublicUrlSource`); demo wiring lives in `examples/react-native-demo/src/`.
  `ESignature` is provider-agnostic - the `src/signing/` module owns acquisition
  + event protocol, so adding a provider never touches the component.
- `graphql` stays on 16.x repo-wide (Apollo Server 5 peer range)
- Do all branch work in a git worktree (`git worktree add ../esign-<topic> -b <branch> origin/main`),
  never by switching branches in the main clone: several agent sessions share
  that checkout, and a commit made there lands on whatever branch another
  session left checked out
- Run `npm test` and `npm run typecheck` before committing

## Testing

- Library tests: `packages/esign-react-native/src/__tests__/`
- Demo tests: `examples/react-native-demo/__tests__/` + `examples/react-native-demo/src/__tests__/`
- Backend unit tests: `apps/api/tests/` (DB mocked); E2E: `apps/api/tests/e2e/`
  (real Postgres via `docker-compose.test.yml`)
- Native-module mocks live with the library and are shared by the demo

## Troubleshooting

- **Metro cache**: `npm start -- --reset-cache`
- **Stale watchman** (after moving files): `watchman watch-del . && watchman watch-project .`
- **Clean Android build**: `cd examples/react-native-demo/android && ./gradlew clean`
- **Clean iOS build**: `cd examples/react-native-demo/ios && xcodebuild clean`
- **Reinstall deps**: `rm -rf node_modules package-lock.json && npm install` (root lockfile only)
