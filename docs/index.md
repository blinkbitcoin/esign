# Project Documentation Index

**Project:** esign
**Updated:** 2026-09-10

---

## Project Overview

| Attribute | Value |
|-----------|-------|
| **Type** | Monorepo (npm workspaces): five packages (incl. the service) + two demo apps + tooling |
| **Domain** | Fintech / E-Signature |
| **Primary Language** | TypeScript |
| **Architecture** | React Native / React (web) + Express/Apollo, hexagonal server library |

### Quick Reference

#### Libraries (`packages/`) - the product
- **`esign-react-native/`:** publishable React Native library (react-native-builder-bob); `ESignature` (WebView) + `useESignature` over the core; peers react, react-native, @apollo/client, graphql, webview, netinfo
- **`esign-react/`:** the same API for the browser (iframe embed, DocuSign.js source)
- **`esign-core/`:** platform-agnostic `SigningSource` abstraction, sources (proxy / Web Forms / public URL), Apollo factory, codegen - a dependency of both
- **`esign-node/`:** Node-only: DocuSign client (JWT grant), `createWebFormInstance` (locked prefill), the envelope domain over the `ESignProvider` + `EnvelopeStore` ports, Fetch handlers, `/express` router; the backend is built on it
- **`esign-service/`:** the whole service as one deployable - a Fetch core that always mints and adds envelope orchestration when `DATABASE_URL` is set; runs as a container, a Node process, a Vercel route or a Cloudflare Worker from one env contract; see below

#### Demo app (`examples/react-native-demo/`) - integration/E2E host
- **Framework:** React Native 0.86.0
- **Entry Point:** `App.tsx` (hosts the library component)
- **E2E:** `.maestro/` flows

#### Server examples (`examples/*-demo/`, the two in-process shapes on `esign-node`; the third is the service)
- **`mint-only-demo/`:** an existing GraphQL API adds one mutation that mints a locked Web Forms instance (the smallest backend footprint)
- **`serverless-handler-demo/`:** the Fetch handlers (mint + webhook) behind a route handler, plain Node adapter

#### The service (`packages/esign-service/`)
- **Framework:** none - a Fetch-native core (`createESignApp(env)`), composed from `@blinkbitcoin/esign-node`; `@hono/node-server` bridges it to Node, Apollo Server 5.5.x executes GraphQL when envelopes are on
- **Database:** PostgreSQL via Knex 3.3.x (the Knex `EnvelopeStore`), only with `DATABASE_URL`
- **Entry Points:** `src/index.ts` (the core), `src/node.ts` (the process; also `npx esign-service`), `src/vercel.ts`, `src/cloudflare.ts`
- **Capabilities by env:** the mint is always on; `DATABASE_URL` adds the GraphQL API, the webhook and the store. `GET /health` reports which
- **Role:** The reference host for mode 3 (and the Web Forms mint endpoint); the backend every E2E suite runs against; ships as a container image (`ghcr.io/blinkbitcoin/esign-service`) and as a package with deploy templates in `deploy/`
- **API:** mint at `POST /webform/instance`, bridge at `GET /signing/return`, health at `GET /health`; with envelopes, GraphQL at `/graphql` and the webhook at `/webhook/esign`
- **The host's two obligations:** expose JWKS or share an HS256 secret (session verification), and expose `TERMS_URL` when the locked terms come from host data

#### Tooling (`scripts/`)
- **Type:** `tooling` npm workspace: ci/, e2e/, release/ shell + node; `lib/*.mjs` Vitest-covered at 100%

---

## Documentation

Organized by namespace - pick by what you're doing:

### `integration/` - using the packages in your app

| Doc | Covers |
|-----|--------|
| [consuming.md](integration/consuming.md) | Registry setup (GitHub Packages) + the minimal Web Forms-only install |
| [locked-terms.md](integration/locked-terms.md) | **The recipe for locked terms (mode 2), backend + app:** the form rules, the one mutation, the bridge route, the app source, what to verify |
| [docusign-lessons.md](integration/docusign-lessons.md) | **The rules behind it:** every lesson from the live DocuSign runs on one page - the Text-only rule for read-only fields, why the mint is server-side, completion without DocuSign.js, account gotchas |
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

### `operations/` - running the repository

| Doc | Covers |
|-----|--------|
| [production.md](operations/production.md) | **Running the mint in production, by role:** what runs where (in-process vs the service), DocuSign go-live, backend, DevOps (deploy, env, private key, boot guard), mobile, verification, failure modes |
| [live-e2e-ci.md](operations/live-e2e-ci.md) | The live DocuSign suite in GitHub Actions: environment, secrets, variables, the CI integration key + consent, triggers, rotation, failure modes |

### Root

| Doc | Covers |
|-----|--------|
| [development-guide.md](./development-guide.md) | Working on this repo: setup, commands, quality gates, CI |
| [releasing.md](./releasing.md) | How a merged PR becomes a version: release-please, the release PR, the changelog, what merging it does |
| [upgrading.md](./upgrading.md) | What changes for app, backend and form owners in the 2026-09 stack:<br>additive API, deprecated names and their canonical homes, the `apps/api` move |
| [diagrams/](./diagrams/README.md) | All nine diagrams (render directly on GitHub) |

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
make e2e-ios                # or: make e2e-android
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

### "I build the app" (app developer / integrator)
1. [Consuming the Packages](integration/consuming.md) - registry setup + minimal Web Forms-only install
2. Pick a mode: [integration/webforms.md](integration/webforms.md) (Web Forms / public URL) or [integration/docusign-proxy.md](integration/docusign-proxy.md) (proxy envelope mode, webhooks)
3. [locked-terms.md](integration/locked-terms.md) for mode 2 end to end, and [error-codes.md](integration/error-codes.md) for what `onError` can hand you

### "I own the backend API" (backend developer)
1. [The mint-only preset](../packages/esign-node/README.md#mint-only-the-whole-surface-in-three-lines) - the routes inside your own Node API, session check and `prefill` hook
2. [`examples/mint-only-demo`](../examples/mint-only-demo/README.md) - the same shape, runnable
3. [Running the mint in production](operations/production.md#3-backend-developer) - what a backend owes the mint, in either tier

### "I deploy and operate" (DevOps engineer)
1. [Deploy table](../packages/esign-service/README.md#deploy) - the copy-paste per target (container, Compose, Kubernetes, Vercel, Cloudflare, Lambda)
2. [Running the mint in production](operations/production.md#4-devops) - the environment, the private key per platform, the boot guard, health and shutdown
3. [Live DocuSign E2E in CI](operations/live-e2e-ci.md) for the opt-in CI job

### "I want to add a new feature"
1. [Development Guide](./development-guide.md) for workflow + quality gates
2. Architecture doc for the part you are touching

---

## Document Maintenance

This documentation is maintained by hand alongside code changes - update the
relevant doc in the same change.

