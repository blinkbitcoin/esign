# @blinkbitcoin/esign-react

Plug-and-play e-signature signing flow for **React web** apps, backed by the
e-sign GraphQL service. Same public API as
[`@blinkbitcoin/esign-react-native`](../esign-react-native) — the WebView
becomes an `<iframe>`, NetInfo becomes `navigator.onLine`.

## Install

```sh
npm install @blinkbitcoin/esign-react
```

Peer dependencies: `react` (>=18) — plus `@apollo/client` · `graphql` (16.x) **only for proxy mode** (optional peers)

## Usage

Provider-agnostic: give the component a `SigningSource`. Three are built in
(same as the RN package).

```tsx
import {
  ESignature,
  createESignApolloClient,
  createProxySigningSource,
} from '@blinkbitcoin/esign-react';
import { ApolloProvider } from '@apollo/client/react';

// Mode 1 - Proxy: backend creates an envelope and returns an embedded URL.
const client = createESignApolloClient({
  uri: 'https://your-backend.example.com/graphql',
  getAuthToken: () => readTokenFromStorage(),
});
const source = createProxySigningSource({
  client,
  contractType: 'loan_agreement',
  recipient: { name: 'Jane Doe', email: 'jane@example.com' },
  allowedOrigin: 'https://your-signing-provider.example.com', // recommended
});

<ApolloProvider client={client}>
  <ESignature
    source={source}
    onComplete={({ envelopeId }) => {/* signed */}}
    onError={({ code, message }) => {/* handle */}}
    onCancel={() => {/* cancelled */}}
  />
</ApolloProvider>
```

```tsx
// Mode 2 - DocuSign Web Forms (host mints the instance URL):
const source = createWebFormsSource({
  createInstance: () => fetch('/onboarding/webform', { method: 'POST' }).then((r) => r.json()),
  allowedOrigin: 'https://apps.docusign.com',
});
// Mode 3 - Public Web Form URL (no backend; prefill via query params):
const source = createPublicUrlSource({ url, allowedOrigin: 'https://apps.docusign.com' });
```

## Web-Specific Notes

- **`allowedOrigin`** now lives on the **source** (recommended in production):
  the signing page posts events via `window.postMessage`, which any embedded
  content can do — the source's `allowedOrigin` pins the accepted origin. Unset,
  any message matching the event shape is accepted (fine for local dev).
- The message listener is attached only while the signing iframe is mounted,
  accepts both object and JSON-string payloads, and silently ignores
  unrelated messages (devtools, extensions, other embeds).
- Elements expose stable `data-testid`s mirroring the RN package's testIDs.

## Public API

Identical surface to the RN package: `ESignature`, the three
`create*SigningSource` factories + the `SigningSource` abstraction,
`createESignApolloClient`, `ErrorCode`/`ErrorCodes` (generated from the
service schema), `getErrorMessage`, the GraphQL operations and their
generated types.

## Development (in this monorepo)

```sh
make test        # 43 Jest (jsdom + Testing Library) tests, 100% coverage (enforced threshold)
make codegen     # regenerate types from ../../apps/api/schema.graphql
make build       # tsup (ESM + CJS + types)
```

Types in `src/generated/` are generated — edit the backend schema, not them.

Example integration: [`examples/react-demo`](../../examples/react-demo) (Vite).
