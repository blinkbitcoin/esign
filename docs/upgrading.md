# Upgrading

What changes for you when the 2026-09 stack (PRs #72, #73, #74) lands, by
audience. Short version: **the public API is additive; nothing you import
today stops working.** The release is a minor version (no commit carries a
breaking-change marker), and the changelog lists the additions.

## App developers (React Native, React web)

Nothing to do. Every export keeps its name, path and behaviour. New, optional:

| You want | Use |
|---|---|
| Mint a hosted-form instance through your backend without writing the<br>fetch | `createWebFormsSource({ mint: { url, getAuthToken }, prefill })` |
| Mint through your own client (a GraphQL mutation) | `createWebFormsSource({ createInstance })` |
| A provider-neutral hosted-form source | `createHostedFormSource`, `createHostedFormMinter`, `interpretBridgeEvent` |
| The DocuSign adapter on its own | `@blinkbitcoin/esign-core/docusign`, `@blinkbitcoin/esign-react/docusign`,<br>`@blinkbitcoin/esign-react-native/docusign` (all Apollo-free) |
| Completion from a real form in a plain WebView or iframe | nothing: the instance's `returnUrl` and your backend's bridge deliver it<br>([locked-terms.md](integration/locked-terms.md)) |

`@blinkbitcoin/esign-core/webform` and `@blinkbitcoin/esign-react-native/webform`
stay as Apollo-free aliases of the `/docusign` entries.

## Backend developers

`@blinkbitcoin/esign-server` is new. If you ran the service from the repo:

| Before | After |
|---|---|
| `apps/api/` | `examples/full-service-demo/` (same env names, routes, image name<br>`esign-api`) |
| `apps/api/Dockerfile` | `examples/full-service-demo/Dockerfile` (build from the repo root, as<br>before) |
| Provider chosen by a hand-written factory | `providerFromEnv` from the package, keyed by `ESIGN_PROVIDER` (same values) |

Hosts that only need the mint call: [locked-terms.md](integration/locked-terms.md).

## Deprecated names (kept until the next major)

Each carries `@deprecated` JSDoc naming the canonical import; behaviour is
identical. Plan to move at your convenience.

| Deprecated | Canonical |
|---|---|
| `interpretProxyEvent` | `interpretBridgeEvent` |
| `createWebFormInstance?` on `ESignProvider`, `supportsWebForms` | `createHostedFormInstance?`, `supportsHostedForms` |
| `WebFormInstanceOptions`, `WebFormInstanceResult` (server) | `HostedFormInstanceOptions`, `HostedFormInstanceResult` |
| core module paths `signing/events`, `signing/mint`,<br>`signing/webFormsSource`, `signing/publicUrlSource` | `@blinkbitcoin/esign-core/docusign` (DocuSign) or the root (neutral) |
| `packages/esign-react/src/docusignWebForms` module path | `@blinkbitcoin/esign-react/docusign` |
| `packages/esign-server/src/{pages,prefill,bridgeScript}` DocuSign names | `@blinkbitcoin/esign-server/docusign`; `CLIENT_EVENTS` / `ClientEvent` from<br>the root |

Removal happens in a major release, announced in the changelog, after every
in-repo consumer has moved.

## Form owners (DocuSign builder)

Not an API change, but the one rule that decides whether a locked Web Form
can be completed: **read-only fields must be Text or Dropdown fields**; a
read-only Number or Date field makes DocuSign refuse the submission
([docusign-lessons.md](integration/docusign-lessons.md)). Existing forms
with read-only Number or Date fields need a copy with those fields retyped
(field types freeze on activation).
