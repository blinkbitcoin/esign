# Project Overview

**Project:** blink-esign
**Type:** Multi-part (Mobile + Backend)
**Domain:** Fintech / E-Signature
**Updated:** 2026-07-02

## Executive Summary

E-signature integration for React Native apps. The **backend service** orchestrates envelopes against e-sign providers (DocuSign, behind a provider-agnostic adapter interface); the **@blinkbitcoin/esign-react-native library** is the plug-and-play UI any host app integrates; the **demo app** exists for manual and E2E testing. Target: financial services applications.

## Repository Structure

```
Repository Type: monorepo (npm workspaces)
├── apps/api/                     → 🖥️ THE SERVICE (Express + Apollo + Knex)
├── packages/esignature-core/     → 🧩 Shared platform-agnostic core
├── packages/esign-react-native/  → 📦 THE PRODUCT (RN library, WebView)
├── packages/esign-react/         → 📦 THE PRODUCT (web library, iframe)
├── examples/react-native-demo/   → 📱 RN integration demo (Maestro E2E host)
└── examples/react-demo/          → 🌐 Web integration demo (Playwright E2E host)
```

All three packages publish to GitHub Packages under `blinkbitcoin`; Web
Forms-only consumers use the Apollo-free `/webform` subpath entries
(see [consuming.md](consuming.md)).

## Parts Overview

### Library (`packages/esign-react-native/`)

| Attribute | Value |
|-----------|-------|
| **Type** | Publishable React Native library (the product) |
| **Build** | react-native-builder-bob (CJS + ESM + types) |
| **Language** | TypeScript |
| **Public API** | `ESignature` component + `createESignApolloClient` factory |
| **Peer deps** | react, react-native, @apollo/client, graphql, webview, netinfo |

### Demo app (`examples/react-native-demo/`)

| Attribute | Value |
|-----------|-------|
| **Type** | React Native app (integration demo + E2E host) |
| **Framework** | React Native 0.86.0 |
| **Role** | Hosts the library for manual testing and Maestro E2E |

### Backend

| Attribute | Value |
|-----------|-------|
| **Type** | API Backend |
| **Framework** | Express 5.2.x + Apollo Server 5.5.x |
| **Language** | TypeScript |
| **Database** | PostgreSQL via Knex.js 3.3.x |
| **Key Features** | GraphQL API, Webhook handling, Audit logging |

## Technology Stack Summary

| Layer | Mobile | Backend |
|-------|--------|---------|
| **Runtime** | React Native 0.86.0 | Node.js >= 22.11 |
| **Language** | TypeScript 6.0 | TypeScript 6.0 |
| **API** | Apollo Client 4.2 | Apollo Server 5.5 |
| **Data** | React hooks | Knex.js + PostgreSQL |
| **Lint/Format** | ESLint + Biome | Biome |
| **Testing** | Jest 29 | Vitest 4 + Supertest |
| **E2E** | Maestro | Vitest E2E + Docker |

## Key Features

1. **Embedded Signing** - DocuSign WebView integration for in-app contract signing
2. **Provider Abstraction** - Interface-based design supporting multiple e-sign providers
3. **Audit Logging** - Complete action trail for compliance
4. **Error Handling** - Session expiration, offline detection, graceful recovery
5. **Security** - HMAC webhook validation and JWT auth (fail-closed by default; the server refuses to boot without the secrets unless `ALLOW_INSECURE_DEV=true`), rate limiting, security headers (helmet), webhook replay/downgrade guard, provider-ID protection, PII-safe audit metadata. See [docs/security.md](security.md).

## Architecture Highlights

- **Provider Pattern**: `ESignProvider` interface (outbound API + inbound webhooks) with `DocuSignProvider` and `MockProvider` implementations
- **GraphQL API**: `createEnvelope` initiates signing; `getSigningUrl` restarts expired sessions
- **Webhook Processing**: Provider-agnostic `/webhook/esign` endpoint; verification and parsing delegated to the configured provider, idempotent transactional status sync
- **Component Design**: Self-contained `ESignature` component with typed props and callbacks

## Quick Links

- [Architecture - Mobile](./architecture-mobile.md)
- [Architecture - Backend](./architecture-backend.md)
- [Source Tree Analysis](./source-tree-analysis.md)
- [Development Guide](./development-guide.md)
- [API Contracts](./api-contracts-backend.md)
- [Data Models](./data-models-backend.md)

## Related Documentation

| Document | Location | Description |
|----------|----------|-------------|
