---
name: regenerate-mermaid-diagrams
description: Use when editing or adding any diagram under docs/diagrams/ (sources are src/*.mmd; mermaid-diagrams.md is generated - always run `make diagrams` after changing a source), or when architecture, data-model, or signing-flow changes make the diagrams stale.
---

# Regenerate Mermaid Diagrams

Update the diagrams under `docs/diagrams/`. Mermaid is the single diagram
*source* format on purpose: it diffs as text and is hand-maintainable
alongside the docs. The combined page embeds pre-rendered SVGs so it loads
instantly on GitHub (eight live mermaid blocks each boot their own render
iframe, which is slow).

**Edit the per-diagram sources in `docs/diagrams/src/*.mmd`** - they are
canonical. `docs/diagrams/*.svg` and `docs/diagrams/mermaid-diagrams.md`
are GENERATED from them by `make diagrams` (pinned mermaid-cli renders the
SVGs; scripts/assemble-diagrams.mjs assembles the page and owns section
titles and prose). A pre-commit hook re-runs this and stages the outputs;
CI fails if the page drifts or an SVG is missing/stale. Adding a diagram =
new .mmd file + an entry in assemble-diagrams.mjs's SECTIONS + a row in the
table below. Keep labels free of bare `;` (mermaid parses it as a statement
separator - mermaid-cli rejects it even where GitHub's renderer is lenient).

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

## The eight diagrams: provenance and embeds

The SVGs are also embedded in the docs each diagram belongs to (same
`[![...](.svg)](.mmd)` pattern as the combined page) - renaming or removing
a diagram must update the "Embedded in" doc too:

| # | Diagram | Type | Source of truth | Embedded in |
|---|---------|------|-----------------|-------------|
| 1 | System Architecture | `flowchart TB` | `README.md` (modes) + `docs/architecture/integration.md`; routes from `apps/api/src/app.ts` | `integration.md` (Parts) |
| 2 | Data Flow (proxy mode) | `flowchart LR` | `docs/architecture/integration.md` end-to-end flow | combined page only (the doc's ASCII flow carries extra detail) |
| 3 | Signing Flow Process | `flowchart TD` | `docs/architecture/mobile.md` state flow; event names from `packages/esign-core/src/signing/` | `mobile.md` (Architecture Pattern) |
| 4 | Database ERD | `erDiagram` | `docs/architecture/data-models.md`; verify against `apps/api/migrations/` | `data-models.md` (ERD section) |
| 5 | Component Hierarchy | `flowchart TB` | `docs/architecture/mobile.md` + demo `App.tsx` | `mobile.md` (Demo Host) |
| 6 | Webhook Flow | `sequenceDiagram` | `docs/architecture/backend.md` webhook section + `apps/api/src/webhook.ts` | `backend.md` (Webhook Flow) |
| 7 | GraphQL Request Flow | `sequenceDiagram` | `docs/architecture/api-contracts.md` + `apps/api/src/schema.ts` | `api-contracts.md` (createEnvelope) |
| 8 | Web Forms Mode Flow | `sequenceDiagram` | `docs/integration/webforms.md` + `apps/api/src/providers/docusign/client.ts` | `webforms.md` (How it flows) |

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

1. Run `make diagrams`; it renders every SVG without a parse error, the
   generated page's image count matches the table above (currently 8), and
   `git status` shows regenerated SVGs only for diagrams you touched.
2. `grep` the sources for stale identifiers: old package names, `Prisma`
   (it is Knex), `docusignId` (it is `providerEnvelopeId`), any route not
   present in `apps/api/src/app.ts`.
3. ERD matches the latest migration exactly (columns, uniqueness, cascade,
   audit `action` values including `session_restart` and `creation_failed`).
4. `docs/index.md` still links the file with an accurate description.
5. Run `npm run format` and `make check-code`.
