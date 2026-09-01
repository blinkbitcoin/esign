---
name: regenerate-mermaid-diagrams
description: Regenerate docs/diagrams/mermaid-diagrams.md from the current documentation and code. Use when architecture, data model, or signing-flow changes make the diagrams stale.
disable-model-invocation: true
---

# Regenerate Mermaid Diagrams

Update the diagrams under `docs/diagrams/`. Mermaid is the single diagram
format on purpose: it renders directly on GitHub, diffs as text, and is
hand-maintainable alongside the docs.

**Edit the per-diagram sources in `docs/diagrams/src/*.mmd`** - they are
canonical. `docs/diagrams/mermaid-diagrams.md` is GENERATED from them by
`make diagrams` (docs/diagrams/assemble.mjs, which also owns section titles
and prose); CI fails if it drifts. Adding a diagram = new .mmd file + an
entry in assemble.mjs's SECTIONS + a row in the table below.

## Ground rules

- **Docs are the source of truth for shape, code for names.** Derive each
  diagram from the doc listed below, then verify every identifier (package
  names, routes, columns, event names) against the code - docs can lag.
- **Never invent components.** If a doc and the code disagree, fix the doc
  first (or flag it), then diagram the corrected state.
- The current package names are `@blinkbitcoin/esign-core`,
  `@blinkbitcoin/esign-react-native`, `@blinkbitcoin/esign-react` under
  `packages/`; the backend is `apps/api`. If these have changed, trust
  `packages/*/package.json` over any doc.

## The eight diagrams, and where each comes from

| # | Diagram | Type | Source of truth |
|---|---------|------|-----------------|
| 1 | System Architecture | `flowchart TB` | `README.md` (modes) + `docs/architecture/integration.md`; routes from `apps/api/src/app.ts` |
| 2 | Data Flow (proxy mode) | `flowchart LR` | `docs/architecture/integration.md` end-to-end flow |
| 3 | Signing Flow Process | `flowchart TD` | `docs/architecture/mobile.md` state flow; event names from `packages/esign-core/src/signing/` |
| 4 | Database ERD | `erDiagram` | `docs/architecture/data-models.md`; verify against `apps/api/migrations/` |
| 5 | Component Hierarchy | `flowchart TB` | `docs/architecture/mobile.md` + demo `App.tsx` |
| 6 | Webhook Flow | `sequenceDiagram` | `docs/architecture/backend.md` webhook section + `apps/api/src/webhook.ts` |
| 7 | GraphQL Request Flow | `sequenceDiagram` | `docs/architecture/api-contracts.md` + `apps/api/src/schema.ts` |
| 8 | Web Forms Mode Flow | `sequenceDiagram` | `docs/integration/webforms.md` + `apps/api/src/providers/docusign/client.ts` |

## Pedagogy and consistency rules

These keep the set readable as a progression, not eight unrelated pictures:

- **Mode-aware labeling.** The repo has three integration modes (public URL /
  Web Forms / proxy). Any diagram that is mode-specific says so in its
  heading (e.g. "Data Flow Diagram (proxy mode)"); the System Architecture
  diagram shows where the three modes diverge and notes that public-URL mode
  needs no backend and only the proxy source touches Apollo.
- **Same names everywhere.** A node representing `ESignature`,
  `SigningSource`, a route, or a DB column uses the exact identifier from
  code - never a paraphrase ("Signing component") that readers must map.
- **Consistent colors** (hex, applied via `style`):
  - `#b2f2bb` green - success / terminal-good states
  - `#ffc9c9` red - error / terminal-bad states
  - `#ffec99` yellow - recoverable states (offline, session expiry, cancel)
- **Event vocabulary is real.** Use the actual signing event names
  (`signing_complete`, `cancel`, `decline`, `session_timeout`; DocuSign
  `sessionEnd` with `signingResult` / `formConfirmation` / `sessionTimeout`)
  from `packages/esign-core/src/signing/events.ts` - the diagrams double as
  protocol documentation.
- Separate diagrams with `---`; keep the one-line intro under each `##`
  heading if it adds a constraint the picture can't show.

## Verification before finishing

1. Run `make diagrams`; the generated file's block count matches the table
   above (currently 8) and `git status` shows no unexpected drift.
2. `grep` the file for stale identifiers: old package names, `Prisma`
   (it is Knex), `docusignId` (it is `providerEnvelopeId`), any route not
   present in `apps/api/src/app.ts`.
3. ERD matches the latest migration exactly (columns, uniqueness, cascade,
   audit `action` values including `session_restart` and `creation_failed`).
4. `docs/index.md` still links the file with an accurate description.
5. Run `npm run format` and `make check-code`.
