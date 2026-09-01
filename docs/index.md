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

### Core Documentation
- [Source Tree Analysis](./source-tree-analysis.md) - Annotated directory structure
- [Development Guide](./development-guide.md) - Setup, commands, and workflows
- [DocuSign Setup](./docusign-setup.md) - Real-DocuSign setup for proxy mode + the live smoke-test checklist
- [Web Forms Setup](./webforms-setup.md) - DocuSign Web Forms mode: mock and live runs, event model
- [Consuming the Packages](./consuming.md) - GitHub Packages setup + minimal webform-only install
- [Security Model](./security.md) - Auth, webhooks, headers, rate limiting, fail-closed boot

### Architecture
- [Architecture - Mobile](./architecture-mobile.md) - React Native component architecture
- [Architecture - Backend](./architecture-backend.md) - Express/Apollo service architecture
- [Integration Architecture](./integration-architecture.md) - How the parts communicate (GraphQL, webhooks, WebView events)

### API & Data
- [API Contracts - Backend](./api-contracts-backend.md) - GraphQL schema and REST endpoints
- [Data Models - Backend](./data-models-backend.md) - Knex schema and database design

### Diagrams
- [Diagrams (Mermaid)](./diagrams/mermaid-diagrams.md) - System architecture, data flow, signing flow, ERD, component hierarchy, webhook + GraphQL + Web Forms sequences (renders directly on GitHub)

---

## Existing Documentation

### AI Assistant Instructions
| Document | Location | Description |
|----------|----------|-------------|
| CLAUDE.md | `./CLAUDE.md` | Claude Code assistant instructions |
| AGENTS.md | `./AGENTS.md` | Multi-agent collaboration instructions |



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
2. Review [Source Tree Analysis](./source-tree-analysis.md)
3. Dive into architecture docs for specific parts

### "I want to set up my dev environment"
1. Follow [Development Guide](./development-guide.md)

### "I want to understand the API"
1. Review [API Contracts - Backend](./api-contracts-backend.md)
2. Check [Data Models](./data-models-backend.md) for schema

### "I want to integrate signing into my own app"
1. [Consuming the Packages](./consuming.md) - registry setup + minimal Web Forms-only install
2. Pick a mode: [webforms-setup.md](./webforms-setup.md) (Web Forms / public URL) or [docusign-setup.md](./docusign-setup.md) (proxy envelope mode, webhooks)

### "I want to add a new feature"
1. [Development Guide](./development-guide.md) for workflow + quality gates
2. Architecture doc for the part you are touching

---

## Document Maintenance

This documentation is maintained by hand alongside code changes - update the
relevant doc in the same change.

