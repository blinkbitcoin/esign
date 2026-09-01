# blink-esign

Embedded e-signing for React Native and React web apps. One `ESignature`
component, three integration modes - **you only need the parts for your
mode**, and for two of the three that is a single small package:

| Mode | What it is | What your app installs | Backend required |
|------|-----------|------------------------|------------------|
| **DocuSign Web Forms** | Prefilled form-based signing; your backend mints an instance URL with one API call | One package via the Apollo-free `/webform` entry - **no Apollo, no GraphQL** | One authenticated endpoint on *your* backend (or run this repo's service) |
| **Public URL** | A published public form URL embedded directly | Same minimal `/webform` entry | **None** |
| **Proxy envelope** | Full envelope orchestration: templates, per-recipient sessions, restart on expiry, webhook status sync | The package + `@apollo/client` + `graphql` | This repo's backend service (`apps/api`) |

The GraphQL backend, Apollo wiring, and provider adapters in this repo serve
the **proxy mode**. If you only need Web Forms, none of that ships with you -
see [Web Forms](#docusign-web-forms-minimal-install) below and
[docs/consuming.md](docs/consuming.md).

## Integration

### DocuSign Web Forms (minimal install)

```sh
npm i @blinkbitcoin/esign-react-native react-native-webview @react-native-community/netinfo
# NO @apollo/client, NO graphql
```

```tsx
import { ESignature, createWebFormsSource } from '@blinkbitcoin/esign-react-native/webform';

const source = createWebFormsSource({
  // One call to YOUR backend, which mints the instance URL server-side
  // (keeps DocuSign credentials off the device). Returns { url }.
  createInstance: () =>
    fetch('https://your-backend.example.com/webform/instance', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    }).then(r => r.json()),
});

<ESignature source={source} onComplete={…} onError={…} onCancel={…} />;
```

The `/webform` subpath is **Apollo-free by construction** (a guard test walks
the import graph). Registry setup + web equivalent:
[docs/consuming.md](docs/consuming.md); Web Forms specifics (event model,
real-DocuSign caveats): [docs/webforms-setup.md](docs/webforms-setup.md).

### Public URL (no backend at all)

```tsx
import { ESignature, createPublicUrlSource } from '@blinkbitcoin/esign-react-native/webform';

const source = createPublicUrlSource({ url: 'https://your-published-form-url' });
```

### Proxy envelope mode (full flow, needs the backend service)

Envelope creation from templates, restartable per-recipient sessions, and
webhook-driven status sync - this is what `apps/api` and the Apollo pieces
are for:

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
</ApolloProvider>;
```

All three modes drive the **same component with the same callbacks** - the
mode lives entirely in the `SigningSource` you pass. The web package
(`@blinkbitcoin/esign-react`) mirrors this API for React DOM apps, including
a DocuSign.js source for real Web Forms embedding on web.

Peer dependencies: `react`, `react-native`, `react-native-webview`,
`@react-native-community/netinfo` - plus `@apollo/client` + `graphql`
**only for proxy mode** (optional peers).

Packages publish to GitHub Packages under the `blinkbitcoin` org - see
[docs/consuming.md](docs/consuming.md).

## Repository Layout

Proxy-mode infrastructure is clearly separated from the packages you install:

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
