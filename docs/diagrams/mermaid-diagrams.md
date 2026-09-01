<!-- GENERATED FILE - do not edit. Sources: src/*.mmd; run `make diagrams`. -->

# Diagrams

Pre-rendered SVGs for instant loading; click a diagram to open its editable
Mermaid source in [src/](src/) (which renders natively on GitHub, in VS Code,
and in Obsidian). Regenerate with `make diagrams`.

---

## System Architecture

[![System Architecture](system-architecture.svg)](src/system-architecture.mmd)

The public-URL mode needs no backend at all; Apollo/GraphQL is loaded only
by the proxy source (the `/webform` package entries never reach it).

---

## Data Flow Diagram (proxy mode)

[![Data Flow Diagram (proxy mode)](data-flow-proxy.svg)](src/data-flow-proxy.mmd)

---

## Signing Flow Process

[![Signing Flow Process](signing-flow.svg)](src/signing-flow.mmd)

---

## Database ERD

[![Database ERD](database-erd.svg)](src/database-erd.mmd)

---

## Component Hierarchy

[![Component Hierarchy](component-hierarchy.svg)](src/component-hierarchy.mmd)

---

## Webhook Flow

[![Webhook Flow](webhook-flow.svg)](src/webhook-flow.mmd)

---

## GraphQL Request Flow

[![GraphQL Request Flow](graphql-request-flow.svg)](src/graphql-request-flow.mmd)

---

## Web Forms Mode Flow

[![Web Forms Mode Flow](webforms-flow.svg)](src/webforms-flow.mmd)
