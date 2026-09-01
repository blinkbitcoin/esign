# blink-esign

Embedded e-signing for React Native and React web apps. One `ESignature`
component, three integration modes - **you only need the parts for your
mode**, and for two of the three that is a single small package:

| Mode | What it is | What your app installs | Backend required |
|------|-----------|------------------------|------------------|
| **1. Public URL** | A published public form URL embedded directly | One package via the Apollo-free `/webform` entry - **no Apollo, no GraphQL** | **None** |
| **2. Web Forms instances** | Prefilled per-signer forms; your backend mints an instance URL with one API call | Same minimal `/webform` entry | One authenticated endpoint on *your* backend (or run this repo's service) |
| **3. Proxy envelope** | Full envelope orchestration: templates, per-recipient sessions, restart on expiry, webhook status sync | The package + `@apollo/client` + `graphql` | This repo's backend service (`apps/api`) |

The GraphQL backend, Apollo wiring, and provider adapters in this repo exist
for **mode 3 only**. If you need modes 1 or 2, none of that ships with you -
the [Integration](#integration) section walks each mode from simplest up.

## Integration

Every mode drives the **same component with the same callbacks** - the only
thing that changes is the `SigningSource` you pass in:

```tsx
<ESignature source={source} onComplete={…} onError={…} onCancel={…} />
```

The modes below go from simplest to most capable. **Start with the first
one that covers your needs.**

### 1. Public URL - the simplest (no backend, no credentials)

**Use when:** every signer gets the same form and you don't need per-signer
prefill - you just publish the form in the DocuSign Web Forms builder and
embed its public URL.

Install the package and the two WebView peers - nothing else:

```sh
npm i @blinkbitcoin/esign-react-native react-native-webview @react-native-community/netinfo
# note: no @apollo/client, no graphql - not needed for modes 1 and 2
```

```tsx
import { ESignature, createPublicUrlSource } from '@blinkbitcoin/esign-react-native/webform';

const source = createPublicUrlSource({ url: 'https://your-published-form-url' });
```

That's the whole integration: the component embeds the URL in a WebView and
your callbacks fire on completion/cancel/error.

### 2. Web Forms instances - adds per-signer prefill (one backend endpoint)

**Use when:** you want each signer's data prefilled into the form, or need to
know *which* signer completed it. DocuSign requires minting a short-lived
**instance URL** per signer, and that API call carries your DocuSign
credentials - so it belongs on a backend, not in the app.

1. Add **one authenticated endpoint to your own backend** that calls
   DocuSign's `createInstance` with the signer's `clientUserId` + prefill
   values and returns `{ url }`. (This repo's service implements it as
   `POST /webform/instance` if you'd rather run it than write it - but any
   backend able to make one REST call works.)
2. Install exactly as in mode 1 (same minimal packages, still no Apollo).
3. Point the source at your endpoint:

```tsx
import { ESignature, createWebFormsSource } from '@blinkbitcoin/esign-react-native/webform';

const source = createWebFormsSource({
  createInstance: () =>
    fetch('https://your-backend.example.com/webform/instance', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    }).then(r => r.json()), // -> { url }
});
```

Modes 1 and 2 import from the `/webform` subpath, which is **Apollo-free by
construction** (a guard test walks the import graph to keep it that way).
Web Forms specifics - event model, real-DocuSign caveats:
[docs/webforms-setup.md](docs/webforms-setup.md).

### 3. Proxy envelope - full orchestration (this repo's backend service)

**Use when:** you need real envelope workflows: creation from DocuSign
templates, a distinct session per recipient, session restart after expiry,
and webhook-driven status tracking in a database. This is the mode the rest
of this repo exists for - `apps/api` (GraphQL service, provider adapters,
webhooks) plus the Apollo client wiring.

1. Deploy this repo's backend ([apps/api](apps/api/README.md)).
2. Install the package **plus** the Apollo peers:

```sh
npm i @blinkbitcoin/esign-react-native react-native-webview @react-native-community/netinfo \
      @apollo/client graphql
```

3. Wire the client and source from the package root (not `/webform`):

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

### Web apps

The web package (`@blinkbitcoin/esign-react`) mirrors all of the above for
React DOM apps (iframe instead of WebView), and adds a DocuSign.js source
for real Web Forms embedding on web - see its
[README](packages/esign-react/README.md).

Packages publish to GitHub Packages under the `blinkbitcoin` org - registry
setup: [docs/consuming.md](docs/consuming.md).

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

## Developing This Repo

Only needed if you're working on the packages or the backend themselves -
**consuming the packages requires none of this** (see
[Integration](#integration) above).

One-time setup:

```sh
make install                             # npm ci across all workspaces (also installs git hooks)
direnv allow . && direnv allow apps/api  # once per machine (loads env + nix flake dev shell)
```

Run the full proxy-mode stack against the demo apps:

```sh
make db-up migrate backend              # dev Postgres + migrations + server (:4000)

# in a new terminal:
make start                              # Metro
make ios                                # or: make android
make web                                # or the web demo (Vite)
```

`make help` lists all targets (thin wrappers over the npm workspace scripts):

| Target | Purpose |
|--------|---------|
| `make test` | Unit suites + lint + typecheck + format check |
| `make unit` / `make coverage` | Test suites (100% coverage enforced on packages + backend; demos floored at current level) |
| `make check-code` | Lint + typecheck + format check only |
| `make build` | Build the library (react-native-builder-bob) |
| `make e2e-backend` / `make e2e-web` | Backend / browser E2E: test DB up → migrate → tests → teardown |
| `make e2e-mobile` / `make e2e-mobile-android` | Maestro E2E against a running stack |
| `make test-live` | Opt-in live DocuSign API verification (skips without credentials) |
| `make pods` | iOS CocoaPods install |

See [docs/development-guide.md](docs/development-guide.md) for full setup,
environment variables, and troubleshooting.
