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

### Integration paths

Same state machine in every column; the host takes over more of the screen
from left to right.

| Default | Themed | Headless |
|---|---|---|
| ![Drop in the component](../../docs/images/esign-path-1-default.svg) | ![Recolor and relabel it](../../docs/images/esign-path-2-themed.svg) | ![Bring your own UI](../../docs/images/esign-path-3-headless.svg) |
| `<ESignature source={source} … />` | `theme` · `styles` · `labels` | `useESignature` + your own `iframe` |

### Theming

The default screens ship with the iOS-blue look. "Can we change the blue
button?" is a one-liner: pass `theme`. `styles` overrides individual
elements (`React.CSSProperties`), `labels` overrides copy. Precedence is
base look < `theme` < `styles`; everything is optional and the default
look/copy is unchanged when nothing is passed. `label` still works (it is
the default for `labels.title` and `labels.sign`).

```tsx
<ESignature
  source={source}
  theme={{ primaryColor: '#F7931A', primaryTextColor: '#000' }}
  styles={{ button: { borderRadius: 4 }, title: { fontSize: 24 } }}
  labels={{ title: 'Sign your loan agreement', sign: 'Sign now', success: 'All done!' }}
  onComplete={...} onError={...} onCancel={...}
/>
```

`ESignatureTheme` keys: `primaryColor`, `primaryTextColor`, `mutedTextColor`,
`successColor`, `errorColor`, `warningColor`. `ESignatureStyles` keys are
listed in `ESignatureStyleKey` (`container`, `title`, `button`, `iframe`,
…). `ESignatureLabels` covers every string the built-in screens render.

### Headless usage

When the built-in screens don't fit, `useESignature` runs the same state
machine (offline check, session-expiry restart, success delay) and renders
nothing - the host renders its own buttons and its own embed. `ESignature`
is just one consumer of this hook.

`embed` describes how to embed the active session and is `null` while no
session is active:

```ts
type ESignatureEmbed =
  | { kind: 'iframe'; iframeProps: { src: string; title: string } } // plain sources
  | { kind: 'mount'; ref: React.RefCallback<HTMLDivElement> }        // DocuSign.js sources (createDocuSignWebFormsSource)
  | null;
```

```tsx
import { useESignature } from '@blinkbitcoin/esign-react';

const {
  status, error, isSessionExpired,
  sign, cancel, retry, restart, checkConnection,
  embed,
} = useESignature({ source, onComplete, onError, onCancel });

if (status === 'signing' && embed?.kind === 'iframe') {
  return <iframe {...embed.iframeProps} style={{ width: '100%', height: 600, border: 0 }} />;
}
if (status === 'signing' && embed?.kind === 'mount') {
  return <div ref={embed.ref} style={{ height: 600 }} />; // DocuSign.js mounts its own iframe here
}
if (status === 'error') {
  return <button onClick={isSessionExpired ? restart : retry}>Try again</button>;
}
if (status === 'offline') {
  return <button onClick={checkConnection}>Check connection</button>;
}
return <button onClick={sign}>Sign</button>;
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

Identical surface to the RN package: `ESignature` (with `theme` / `styles`
/ `labels`), the headless `useESignature` hook (same result shape, with
`embed` in place of `webViewProps`), the three
`create*SigningSource` factories + the `SigningSource` abstraction,
`createESignApolloClient`, `ErrorCode`/`ErrorCodes` (generated from the
service schema), `getErrorMessage`, the GraphQL operations and their
generated types.

## Development (in this monorepo)

```sh
make test        # 89 Jest (jsdom + Testing Library) tests, 100% coverage (enforced threshold)
make codegen     # regenerate types from ../../apps/api/schema.graphql
make build       # tsup (ESM + CJS + types)
```

Types in `src/generated/` are generated — edit the backend schema, not them.

Example integration: [`examples/react-demo`](../../examples/react-demo) (Vite).
