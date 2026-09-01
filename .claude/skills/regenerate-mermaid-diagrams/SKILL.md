---
name: regenerate-mermaid-diagrams
description: Regenerate Mermaid diagrams from existing project documentation. Use when architecture docs have been updated and diagrams need to reflect changes.
disable-model-invocation: true
---

# Regenerate Mermaid Diagrams

Regenerate `docs/diagrams/mermaid-diagrams.md` from current project documentation.

## Steps

1. Read the existing documentation in `docs/`:
   - `docs/architecture-mobile.md` - Mobile app components and state
   - `docs/architecture-backend.md` - Backend services and providers
   - `docs/data-models-backend.md` - Database schema and relationships
   - `docs/api-contracts-backend.md` - GraphQL schema and endpoints

2. Generate these diagrams:

   **System Architecture** (flowchart TB)
   - Mobile app subgraph with key components
   - Backend subgraph with services, GraphQL, webhooks
   - External services (DocuSign, Database)
   - Connections with technology labels

   **Data Flow Diagram** (flowchart LR)
   - User actor, numbered process nodes (1.0, 2.0, etc.)
   - Data stores, labeled flows between nodes

   **Database ERD** (erDiagram)
   - All entities from Prisma schema
   - Relationships with cardinality
   - Key fields with types

   **Component Hierarchy** (flowchart TB)
   - React component tree
   - State transitions

   **Webhook Sequence** (sequenceDiagram)
   - DocuSign -> Webhook -> Database flow
   - HMAC validation, status updates

3. Use consistent styling:
   - Green (#b2f2bb) for success states
   - Red (#ffc9c9) for error states
   - Yellow (#ffec99) for warnings/pending
   - Blue (#d0ebff) for primary components

4. Add horizontal rules (---) between diagram sections.

5. Update `docs/project-scan-report.json` timestamp if it exists.

6. Report completion with the file path.
