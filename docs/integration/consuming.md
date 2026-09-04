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

- **Stable** (`latest`): publish a **GitHub Release** with tag `vX.Y.Z`
  (`make release V=X.Y.Z`). The tag is the version - CI stamps it into the
  packages before building them; nothing is committed. It ships once the
  commit's push-to-`main` run is green (a red one blocks it; the publish is
  retried automatically when main turns green). GitHub Packages rejects
  re-publishing an existing version, so a failed release needs a new tag.
- **Prerelease** (`next`): every push to `main` (or a manual
  `ci.yml` dispatch) ships `<next patch after the latest tag>-pre.<run>.<sha>`.
  Install with `npm i @blinkbitcoin/esign-react-native@next`.

In both channels the platform packages pin `@blinkbitcoin/esign-core` to
exactly their own version.

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
npm install --omit=peer @blinkbitcoin/esign-react-native react-native-webview @react-native-community/netinfo
# NO @apollo/client, NO graphql - they are optional peers, only needed for proxy mode
```

> **Why `--omit=peer`:** GitHub Packages strips `peerDependenciesMeta` from
> the metadata npm resolves against, so a plain `npm install` treats the
> *optional* Apollo peers as required and adds `@apollo/client` + `graphql`
> to `node_modules` (unused: `/webform` never loads them, which the publish
> workflow's registry smoke asserts on every release). `--omit=peer` skips
> them; the peers you actually need are named explicitly in the command, so
> they still install. Not needed when installing from a local tarball or a
> registry that serves the field (npmjs).

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
  See [webforms.md](webforms.md).
- The instance URL's token expires ~5 minutes after minting - create the
  instance when the user opens the screen, not in advance.

## Older Metro fallback

Metro honors package `exports` from RN 0.79+. On older setups, deep-import the
shipped source instead: `@blinkbitcoin/esign-react-native/src/webform`.

Error handling: every `onError` code is cataloged in
[error-codes.md](error-codes.md).
