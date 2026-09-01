# Project Documentation Index

**Project:** blink-esign
**Updated:** 2026-09-01

---

## Project Overview

| Attribute | Value |
|-----------|-------|
| **Type** | Monorepo (npm workspaces): library + service + demo app |
| **Domain** | Fintech / E-Signature |
| **Primary Language** | TypeScript |
| **Architecture** | React Native + Express/Apollo |

### Quick Reference

#### Library (`packages/esign-react-native/`) - the product
- **Type:** Publishable React Native library (react-native-builder-bob)
- **Public API:** `src/index.ts` - `ESignature` component + `createESignApolloClient`
- **Peers:** react, react-native, @apollo/client, graphql, webview, netinfo

#### Demo app (`examples/react-native-demo/`) - integration/E2E host
- **Framework:** React Native 0.86.0
- **Entry Point:** `App.tsx` (hosts the library component)
- **E2E:** `.maestro/` flows

#### Backend
- **Framework:** Express 5.2.x + Apollo Server 5.5.x
- **Database:** PostgreSQL via Knex 3.3.x
- **Entry Point:** `apps/api/src/index.ts`
- **Role:** The main service - the library and demo exist to integrate with it
- **API:** GraphQL at `/graphql`, Webhook at `/webhook/esign`

---

## Documentation

Organized by namespace - pick by what you're doing:

### `integration/` - using the packages in your app

| Doc | Covers |
|-----|--------|
| [consuming.md](integration/consuming.md) | Registry setup (GitHub Packages) + the minimal Web Forms-only install |
| [webforms.md](integration/webforms.md) | Modes 1-2 (public URL + Web Forms instances): mock and live runs, event model, embedding options |
| [docusign-proxy.md](integration/docusign-proxy.md) | Mode 3 (proxy envelopes): real-DocuSign setup, return-URL bridge, webhooks, live smoke-test checklist |
| [error-codes.md](integration/error-codes.md) | Every `onError` code, which layer produces it, and the sensible host reaction |

### `architecture/` - how the system works inside

| Doc | Covers |
|-----|--------|
| [mobile.md](architecture/mobile.md) | React Native component: state machine, sources, render states, test doubles |
| [backend.md](architecture/backend.md) | Express/Apollo service: provider pattern, webhook processing, observability |
| [integration.md](architecture/integration.md) | How the parts communicate: GraphQL, webhooks, WebView events, shared error codes |
| [api-contracts.md](architecture/api-contracts.md) | GraphQL schema and REST endpoints |
| [data-models.md](architecture/data-models.md) | Knex schema and database design |
| [security.md](architecture/security.md) | Auth, webhook verification, rate limiting, fail-closed boot |
| [source-tree.md](architecture/source-tree.md) | Annotated directory structure |

### Root

| Doc | Covers |
|-----|--------|
| [development-guide.md](./development-guide.md) | Working on this repo: setup, commands, quality gates, CI |
| [diagrams/](./diagrams/README.md) | All eight diagrams (render directly on GitHub) |

---

## Getting Started

### Quick Start (Development)

```bash
# 1. Install all workspaces (single root lockfile)
npm ci

# 2. Start backend (dev Postgres + migrations + server)
make db-up migrate backend

# 3. Start the demo app (new terminal, from repo root)
make start                    # Metro
make ios                      # or: make android
```

### Run Tests

```bash
# Everything (library + demo + backend)
npm test

# Backend E2E tests (test DB lifecycle included)
make e2e-backend

# Mobile E2E tests (requires Maestro + running stack)
make e2e-mobile             # or: make e2e-mobile-android
```

---

## Navigation by Use Case

### "I want to understand the codebase"
1. Start with the [README](../README.md) (integration modes + repository layout)
2. Review [Source Tree Analysis](architecture/source-tree.md)
3. Dive into architecture docs for specific parts

### "I want to set up my dev environment"
1. Follow [Development Guide](./development-guide.md)

### "I want to understand the API"
1. Review [API Contracts - Backend](architecture/api-contracts.md)
2. Check [Data Models](architecture/data-models.md) for schema

### "I want to integrate signing into my own app"
1. [Consuming the Packages](integration/consuming.md) - registry setup + minimal Web Forms-only install
2. Pick a mode: [integration/webforms.md](integration/webforms.md) (Web Forms / public URL) or [integration/docusign-proxy.md](integration/docusign-proxy.md) (proxy envelope mode, webhooks)

### "I want to add a new feature"
1. [Development Guide](./development-guide.md) for workflow + quality gates
2. Architecture doc for the part you are touching

---

## Document Maintenance

This documentation is maintained by hand alongside code changes - update the
relevant doc in the same change.

