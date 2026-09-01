# blink-esign

E-signature integration for React Native apps: a **backend service** that
orchestrates envelopes against an e-sign provider (DocuSign, with a
provider-agnostic adapter interface), and a **plug-and-play React Native
component** that any host app can drop in to run the signing flow.

## Repository Layout

| Path | What it is |
|------|------------|
| [`apps/api/`](apps/api/README.md) | 🖥️ **The service** — Express + Apollo GraphQL API, Knex/PostgreSQL, provider adapters, webhooks |
| [`packages/esignature-core/`](packages/esignature-core/README.md) | 🧩 **Shared core** — platform-agnostic `SigningSource` abstraction + sources, Apollo factory, GraphQL operations (dependency of both platform packages) |
| [`packages/esign-react-native/`](packages/esign-react-native/README.md) | 📦 **The product (RN)** — publishable React Native library: `ESignature` component over the core |
| [`packages/esign-react/`](packages/esign-react/README.md) | 📦 **The product (web)** — publishable React web library: same flow with iframe embedding |
| [`examples/react-native-demo/`](examples/react-native-demo/README.md) | 📱 **RN integration demo** — full RN app hosting the RN component (manual testing + Maestro E2E) |
| [`examples/react-demo/`](examples/react-demo/README.md) | 🌐 **Web integration demo** — Vite app hosting the web component (`make web`) |
| `docs/` | Current-state documentation ([start here](docs/index.md)) |

## Quick Start

```sh
make install                            # npm ci across all workspaces
direnv allow . && direnv allow apps/api  # once per machine (loads env + nix flake dev shell)

make db-up migrate backend              # dev Postgres + migrations + server (:4000)

# Example app (new terminal)
make start                              # Metro
make ios                                # or: make android
```

## Using the Libraries in Your App

The RN and web packages expose the **same public API** (component, client
factory, error-code contract); pick the one for your platform.

The component is provider-agnostic: give it a `SigningSource` (proxy envelope,
DocuSign Web Forms, or a public URL). Proxy mode:

```tsx
import {
  ESignature,
  createESignApolloClient,
  createProxySigningSource,
} from '@blinkbitcoin/esign-react-native';
import { ApolloProvider } from '@apollo/client/react';

const client = createESignApolloClient({
  uri: 'https://your-backend.example.com/graphql',
  getAuthToken: () => readTokenFromSecureStorage(),
});
const source = createProxySigningSource({
  client,
  contractType: 'loan_agreement',
  recipient: { name, email },
});

<ApolloProvider client={client}>
  <ESignature source={source} onComplete={…} onError={…} onCancel={…} />
</ApolloProvider>
```

Swap the source for `createWebFormsSource` / `createPublicUrlSource` to use
DocuSign Web Forms — the component and callbacks are identical (see the package
READMEs).

Peer dependencies your app provides: `react`, `react-native`,
`react-native-webview`, `@react-native-community/netinfo` — plus
`@apollo/client` + `graphql` **only for proxy mode** (they are optional peers;
Web Forms-only apps import from the Apollo-free
`@blinkbitcoin/esign-react-native/webform` subpath and skip them).

Packages publish to GitHub Packages under the `blinkbitcoin` org — see
[docs/consuming.md](docs/consuming.md) for registry setup and the minimal
webform-only install.

## Development

`make help` lists all targets (thin wrappers over the npm workspace scripts):

| Target | Purpose |
|--------|---------|
| `make test` | Unit suites + lint + typecheck + format check |
| `make unit` / `make coverage` | Test suites (100% coverage enforced on packages + backend; demos floored at current level) |
| `make check-code` | Lint + typecheck + format check only |
| `make build` | Build the library (react-native-builder-bob) |
| `make db-up` / `make migrate` / `make backend` | Dev database + server |
| `make e2e-backend` | Backend E2E: test DB up → migrate → tests → teardown |
| `make ios` / `make android` / `make start` | RN example app |
| `make web` | Web example app (Vite dev server) |
| `make pods` | iOS CocoaPods install |

See [docs/development-guide.md](docs/development-guide.md) for full setup,
environment variables, and troubleshooting.
