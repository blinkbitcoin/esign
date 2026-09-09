# Changelog

Maintained by [release-please](https://github.com/googleapis/release-please)
from Conventional Commit PR titles; see [docs/releasing.md](docs/releasing.md).
The two entries below were written by hand from the v0.1.0 and v0.2.0 GitHub
Releases in the same format release-please prepends to.

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
