# Security Policy

## Reporting a Vulnerability

Please report vulnerabilities **privately** via GitHub's private vulnerability
reporting on this repository (Security tab → "Report a vulnerability").
Do not open public issues for security problems.

You can expect an acknowledgement within a few business days. Please include
reproduction steps and the affected package/version.

## Scope

- The published packages: `@blinkbitcoin/esign-core`,
  `@blinkbitcoin/esign-react-native`, `@blinkbitcoin/esign-react`
- The backend service in `apps/api`

## Security model

The backend's threat model and controls (authentication, webhook HMAC
verification and replay guard, rate limiting, fail-closed boot, provider-ID
protection, PII-safe audit logging) are documented in
[docs/architecture/security.md](docs/architecture/security.md).

## Supported versions

The latest published version of each package. Prereleases (`next` dist-tag)
are development snapshots and receive no separate support.
