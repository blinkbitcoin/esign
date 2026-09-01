# Consuming the Packages in Another App

**Updated:** 2026-09-01

The three client packages publish to **GitHub Packages** under the
`blinkbitcoin` org:

| Package | For |
|---------|-----|
| `@blinkbitcoin/esign-react-native` | React Native apps |
| `@blinkbitcoin/esign-react` | React web apps |
| `@blinkbitcoin/esign-core` | (transitive dependency of both; also usable standalone) |

Publishing has two channels (both gated on the full test fleet - unit
coverage thresholds + all three E2E suites):

- **Stable** (`latest`): publish a **GitHub Release** with tag `vX.Y.Z`.
  The tag must match every package.json version (the workflow refuses a
  mismatch) - bump versions first (GitHub Packages rejects re-publishing
  an existing version).
- **Prerelease** (`next`): every push to `main` (or a manual
  `publish.yml` dispatch) ships `X.Y.Z-pre.<run>.<sha>` with the core
  dependency pinned exactly. Install with
  `npm i @blinkbitcoin/esign-react-native@next`.

## Registry setup (consuming app)

GitHub Packages requires auth even for reads. In the consuming repo:

```ini
# .npmrc (commit this line)
@blinkbitcoin:registry=https://npm.pkg.github.com
# auth (do NOT commit a literal token - use an env var or ~/.npmrc)
//npm.pkg.github.com/:_authToken=${GITHUB_TOKEN}
```

`GITHUB_TOKEN` needs the `read:packages` scope (a classic PAT, or the
built-in token in GitHub Actions).

## Minimal install: DocuSign Web Forms only (React Native)

The `/webform` subpath entry is **Apollo-free by construction** (enforced by
a guard test that walks the import graph): a Web Forms-only app installs **no
GraphQL dependencies at all**.

```sh
npm install @blinkbitcoin/esign-react-native react-native-webview @react-native-community/netinfo
# NO @apollo/client, NO graphql - they are optional peers, only needed for proxy mode
```

```tsx
import {
  ESignature,
  createWebFormsSource,   // API-embedded: your backend mints the instance URL
  createPublicUrlSource,  // OR: a published public form URL, no backend
} from '@blinkbitcoin/esign-react-native/webform';

// Shape 1 - API-embedded (recommended: prefill stays server-side)
const source = createWebFormsSource({
  createInstance: async () => {
    const res = await fetch('https://your-backend.example.com/webform/instance', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ prefill: { full_name: user.name, email: user.email } }),
    });
    if (!res.ok) throw new Error(`Could not start signing (HTTP ${res.status})`);
    return res.json(); // { url }
  },
});

// Shape 2 - public form URL (no backend; prefill rides in the URL - avoid PII)
// const source = createPublicUrlSource({ url: publishedFormUrlWithParams });

<ESignature
  source={source}
  onComplete={() => {/* signed */}}
  onError={({ code, message }) => {/* handle */}}
  onCancel={() => {/* cancelled */}}
/>;
```

Full-featured (proxy envelope mode with the GraphQL backend) instead: import
from the package root and additionally install `@apollo/client` + `graphql`.

## Caveats for real DocuSign Web Forms in React Native

- Event delivery from a **real** DocuSign Web Form inside a plain RN WebView is
  **unverified**: DocuSign delivers completion events via their DocuSign.js
  SDK (web-only, no RN equivalent). What is E2E-proven is the protocol path
  (this repo's mock emits the real `sessionEnd` vocabulary) and the
  return-URL bridge alternative. Validate against a live form before shipping.
  See [webforms-setup.md](webforms-setup.md).
- The instance URL's token expires ~5 minutes after minting - create the
  instance when the user opens the screen, not in advance.

## Older Metro fallback

Metro honors package `exports` from RN 0.79+. On older setups, deep-import the
shipped source instead: `@blinkbitcoin/esign-react-native/src/webform`.
