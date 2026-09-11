# Changelog

Maintained by [release-please](https://github.com/googleapis/release-please)
from Conventional Commit PR titles; see [docs/releasing.md](docs/releasing.md).
The two entries below were written by hand from the v0.1.0 and v0.2.0 GitHub
Releases in the same format release-please prepends to.

## [0.5.0](https://github.com/blinkbitcoin/esign/compare/v0.4.0...v0.5.0) (2026-09-11)


### Features

* **node:** locked prefill and multi-document signing for template envelopes ([#91](https://github.com/blinkbitcoin/esign/issues/91)) ([82de337](https://github.com/blinkbitcoin/esign/commit/82de337c154fc6bef3522c64bc5d7bdf1f613f0f))

## [0.4.0](https://github.com/blinkbitcoin/esign/compare/v0.3.0...v0.4.0) (2026-09-10)

The production release of the backend: one library for hosts that mint in-process, one
service that runs from environment alone as a function or a container, and a runbook by
role. Migration notes: [docs/upgrading.md](docs/upgrading.md); operations:
[docs/operations/production.md](docs/operations/production.md).

### ⚠ Breaking changes

* **Package rename:** `@blinkbitcoin/esign-server` is now `@blinkbitcoin/esign-node`
  (`packages/esign-node`), platform-named like `esign-react` / `esign-react-native`.
  No aliases: update every import, including the `/docusign`, `/express` and `/knex`
  subpaths. ([#83](https://github.com/blinkbitcoin/esign/pull/83), [97e55a3](https://github.com/blinkbitcoin/esign/commit/97e55a3))
* **The service is a package and its image is renamed:** `examples/full-service-demo`
  is now `packages/esign-service` (`@blinkbitcoin/esign-service`, published); the image
  `ghcr.io/blinkbitcoin/esign-api` is now `ghcr.io/blinkbitcoin/esign-service`. ([#83](https://github.com/blinkbitcoin/esign/pull/83))
* **The service is no longer an Express app.** `createApp()` is gone; the entry points
  are `createESignApp(env, deps)` (Fetch) and `startServer(env)` on
  `@blinkbitcoin/esign-service/node`. The container command is `node dist/node.js`,
  migrations are `node dist/node.js migrate` (was `dist/migrate.js`). `express`,
  `helmet`, `cors` and `express-rate-limit` are no longer dependencies. ([#86](https://github.com/blinkbitcoin/esign/pull/86), [302ab25](https://github.com/blinkbitcoin/esign/commit/302ab25))
* **`ESIGN_ENV=production` replaces `NODE_ENV=production`** as the production switch
  (GraphQL introspection off; demo DocuSign hosts and the mock provider refused unless
  `ESIGN_ALLOW_DEMO=true`; a client's own prefill refused unless
  `ESIGN_ALLOW_CLIENT_PREFILL=true`). The image sets `ESIGN_ENV=production` itself; a
  non-container deployment that relied on `NODE_ENV` must set it. ([#84](https://github.com/blinkbitcoin/esign/pull/84), [#86](https://github.com/blinkbitcoin/esign/pull/86))
* **Boot checks moved earlier and changed shape:** `DOCUSIGN_HMAC_KEY` and
  `DOCUSIGN_TEMPLATE_ID` are required only when envelope orchestration is on; a mint
  requires `DOCUSIGN_WEBFORM_ID` and `DOCUSIGN_RETURN_URL` at provider selection;
  `validateSecurityConfig()` is `validateConfig(env, { runtime })`. ([#84](https://github.com/blinkbitcoin/esign/pull/84), [#86](https://github.com/blinkbitcoin/esign/pull/86))

### Features

* **node:** production guard (`ESIGN_ENV`, `ESIGN_ALLOW_DEMO`), hosted-form boot checks
  (`HOSTED_FORM_SETTINGS`, incl. the return URL that used to fail silently), private key
  from `DOCUSIGN_PRIVATE_KEY_BASE64` / `DOCUSIGN_PRIVATE_KEY_FILE`,
  `hostedFormProviderFromEnv`, and two presets that serve the mint, the return-URL
  bridge and `/health`: `createHostedFormRouter` (Express) and `createHostedFormApp`
  (Fetch), with a `prefill` hook so the host computes locked terms from its own data;
  a hook rejects with `Errors.validationError` → 400. ([#84](https://github.com/blinkbitcoin/esign/pull/84), [e621645](https://github.com/blinkbitcoin/esign/commit/e621645))
* **service:** one deployable for the mint and the full envelope orchestration,
  capability by environment: the mint is always on, `DATABASE_URL` adds `/graphql`,
  `POST /webhook/esign` and the Knex store. Entries for Node (the image, in-memory rate
  limits, `TRUST_PROXY`), Vercel and Cloudflare Workers (mint only). Session
  verification via `SESSION_JWKS_URL` or `SESSION_HS256_SECRET` (`JWT_SECRET` stays an
  alias). Locked terms via a `TERMS_URL` callback (`TERMS_SHARED_SECRET`,
  `TERMS_TIMEOUT_MS`; plaintext refused in production unless private or
  `TERMS_ALLOW_INSECURE=true`). Deploy templates for Compose, Kubernetes, Vercel,
  Cloudflare and NixOS ship in the package; `/health` reports the capabilities that
  are on. ([#86](https://github.com/blinkbitcoin/esign/pull/86), [302ab25](https://github.com/blinkbitcoin/esign/commit/302ab25))
* **demo:** the mint-only demo builds, ships a Dockerfile and uses the hosted-form router ([#85](https://github.com/blinkbitcoin/esign/issues/85)) ([aad60ca](https://github.com/blinkbitcoin/esign/commit/aad60cabe7e60a0ac602253ce4d3f6d9b68dfede))

### Documentation

* The production runbook by role (DocuSign go-live, backend, DevOps, mobile, verification,
  failure modes), a "who are you" router and a backend-options table in the README, and
  the architecture docs and diagrams redrawn for the two tiers. ([#87](https://github.com/blinkbitcoin/esign/pull/87), [0ecf631](https://github.com/blinkbitcoin/esign/commit/0ecf631))

## [0.3.0](https://github.com/blinkbitcoin/esign/compare/v0.2.0...v0.3.0) (2026-09-09)


### Features

* **demo:** lock server-minted Web Forms prefill and verify it live ([#72](https://github.com/blinkbitcoin/esign/issues/72)) ([2968341](https://github.com/blinkbitcoin/esign/commit/2968341c26e30b61d54618dd6b724923800354cc))
* link the homepage and issue tracker from the published packages ([#64](https://github.com/blinkbitcoin/esign/issues/64)) ([371617b](https://github.com/blinkbitcoin/esign/commit/371617b2d5f6b33b642a652ee9dc30a83b795717))
* **server:** esign-server package, server examples, live DocuSign verification and hardening ([#73](https://github.com/blinkbitcoin/esign/issues/73)) ([338407a](https://github.com/blinkbitcoin/esign/commit/338407add3d96dec962bff425d80b2fcd9eef5e9))

## [0.2.0](https://github.com/blinkbitcoin/esign/compare/v0.1.0...v0.2.0) (2026-09-04)

Two new integration paths next to the drop-in component, in both `@blinkbitcoin/esign-react` and `@blinkbitcoin/esign-react-native`. No breaking changes; all existing props and testIDs keep working. `@blinkbitcoin/esign-core` is republished unchanged so the three packages stay in lockstep.

### Features

* headless `useESignature` hook and `ESignature` theming (`theme`, `styles`, `labels`) for RN and web ([#60](https://github.com/blinkbitcoin/esign/issues/60)) ([a990939](https://github.com/blinkbitcoin/esign/commit/a99093979805f09b58ab0a651c69c4abc13d7511))

### Bug Fixes

* resolve the CodeQL security-and-quality alerts ([#55](https://github.com/blinkbitcoin/esign/issues/55)) ([58adb33](https://github.com/blinkbitcoin/esign/commit/58adb33f20f79d3388997a6681f1545a51923b33))
* **api:** suppress false-positive CodeQL password-hash alert on JWT secret ([b4496dd](https://github.com/blinkbitcoin/esign/commit/b4496dd67311e56fe39421d25aabf2ea704fc9f0))
* **demo:** regenerate Podfile.lock for react-native 0.86.3 ([#51](https://github.com/blinkbitcoin/esign/issues/51)) ([9249130](https://github.com/blinkbitcoin/esign/commit/924913070c8252b36b2940d2a065a5a927d7dbcf))

## [0.1.0](https://github.com/blinkbitcoin/esign/releases/tag/v0.1.0) (2026-09-02)

Initial public feature set: provider-agnostic `ESignature` component (React Native WebView + React web iframe/DocuSign.js) over a shared `SigningSource` core with three modes: public URL, DocuSign Web Forms instances, and proxy envelopes (Apollo). Apollo-free `/webform` subpath entries for minimal Web Forms-only consumers.

Packages (GitHub Packages, `@blinkbitcoin` scope): `esign-core`, `esign-react-native`, `esign-react`, all `0.1.0`.
