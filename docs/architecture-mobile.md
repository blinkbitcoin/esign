# Architecture - Mobile (Library + Demo)

**Parts:** `packages/esign-react-native` (the product, over `packages/esignature-core`) + `examples/react-native-demo` (integration host)
**Type:** Publishable React Native library with demo app
**Updated:** 2026-09-01

## Technology Stack

| Category | Technology | Version |
|----------|------------|---------|
| Framework | React Native | 0.86.0 |
| React | React | 19.2.7 |
| Language | TypeScript | 6.0.x |
| GraphQL Client | Apollo Client (proxy mode only; optional peer) | 4.2.x |
| WebView | react-native-webview | 14.0.x |
| Network Detection | @react-native-community/netinfo | 12.0.x |
| Safe Area | react-native-safe-area-context | 5.8.x |
| Testing | Jest | 29.7.0 |
| E2E Testing | Maestro | CLI |
| Formatting | Biome | 2.5.x |
| Linting | ESLint 9 flat config (@react-native via FlatCompat) | 9.x |

## Architecture Pattern

**Provider-agnostic component over a `SigningSource` strategy** (the
abstraction lives in `@blinkbitcoin/esignature-core`). The component never
talks to Apollo/DocuSign directly - a source owns URL acquisition and the
event protocol; the component owns the state machine, WebView embedding,
offline handling, and UX.

```
App.tsx (host)
├── builds a SigningSource for its mode:
│     createProxySigningSource    (GraphQL envelope; Apollo; restartable)
│     createWebFormsSource        (DocuSign Web Forms; backend mints URL)
│     createPublicUrlSource       (published public form URL; no backend)
└── ESignature Component (source-driven)
    ├── State Machine (idle → loading → signing → success/error/offline)
    ├── source.start()/restart() for URL acquisition
    └── WebView → postMessage → source.interpret() → normalized events
```

## Package Structure

```
packages/esignature-core/src/       # platform-agnostic (shared with web)
├── index.ts             # Full entry (all sources + Apollo factory)
├── webform.ts           # Apollo-free entry (./webform subpath)
├── signing/             # SigningSource + sources + event interpreters
├── client.ts            # createESignApolloClient factory + ErrorCodes
├── operations.ts        # GraphQL mutations
└── generated/           # Schema-generated types (codegen)

packages/esign-react-native/src/
├── index.ts             # Public API (re-exports core; needs Apollo peers)
├── webform.ts           # Apollo-free entry (./webform subpath, guard-tested)
├── ESignature.tsx       # Component with state machine (WebView)
├── types.ts             # Props, status, and error types
└── __tests__/           # incl. webform-entry Apollo-free guard
```

**Props Interface:**
```typescript
interface ESignatureProps {
  source: SigningSource;   // createProxySigningSource / createWebFormsSource / createPublicUrlSource
  label?: string;          // idle title + button, default "Sign Document"
  onComplete: (result: { envelopeId?: string; status: string }) => void;
  onError: (error: { code: string; message: string }) => void;
  onCancel: () => void;
  successDelayMs?: number; // success screen duration before onComplete
}
```

**State Flow:**
```
idle → loading → signing → success
  ↓        ↓         ↓
offline  error     error ←── sessionExpired preserves the session so
                     ↓        "Restart" calls source.restart() (proxy mode;
                   retry      non-restartable sources fall back to retry)
```

Connectivity is checked via NetInfo before any API call; the `offline`
state offers a "Check Connection" action rather than reporting an error.

## Minimal consumption (Web Forms only)

The `./webform` subpath entries in both core and the RN package are
**Apollo-free by construction** (a guard test walks the import graph):

```tsx
import { ESignature, createWebFormsSource } from '@blinkbitcoin/esign-react-native/webform';
```

`@apollo/client` + `graphql` are optional peers, needed only for proxy mode.
See [consuming.md](consuming.md).

## Entry Points

| File | Purpose |
|------|---------|
| `packages/esign-react-native/src/index.ts` | Library public API (full) |
| `packages/esign-react-native/src/webform.ts` | Apollo-free `./webform` entry |
| `examples/react-native-demo/index.js` | Demo app registration |
| `examples/react-native-demo/App.tsx` | Demo root; `buildSource()` picks the mode via `ESIGN_MODE` |

## Testing Strategy

### Unit Tests
- Component tested against fake `SigningSource`s (no Apollo mocks needed)
- Per-source behavior tested in core (`signing/__tests__/`)
- Apollo-free guard: import-graph walk from each `webform` entry

### E2E Tests (Maestro)
- `examples/react-native-demo/.maestro/` - happy path, cancel-from-page,
  session-timeout→restart, webform-happy-path (tagged `webform`; needs
  `ESIGN_MODE=webform` Metro)
- TestID-based element selection

**TestID Attributes:**
| ID | Component | State |
|----|-----------|-------|
| `sign-document-button` | TouchableOpacity | idle |
| `loading-indicator` | ActivityIndicator | loading |
| `signing-webview` | WebView | signing |
| `success-screen` | View | success |
| `error-message` | Text | error |
| `restart-button` / `retry-button` | TouchableOpacity | error |
| `check-connection-button` | TouchableOpacity | offline |

## Dependencies

### Peer (host app provides)
- `react`, `react-native`
- `react-native-webview` - embedded signing WebView
- `@react-native-community/netinfo` - network state detection
- `@apollo/client`, `graphql` - **optional**; proxy mode only

### Development
- `jest` - testing framework
- `react-test-renderer` - component testing
- `typescript` - type checking

## Platform Support

| Platform | Minimum Version |
|----------|-----------------|
| iOS | 13.4+ |
| Android | API 24+ |

## Integration Points

### Backend Communication (mode-dependent)
- **Proxy mode:** GraphQL over HTTP with `Authorization: Bearer <token>`;
  `createEnvelope` (start) + `getSigningUrl` (session restart). Host injects
  the endpoint (demo: platform-aware in `examples/react-native-demo/src/config.ts`).
- **Web Forms mode:** one authenticated REST call the host wires itself
  (`POST /webform/instance` on its backend) returning the embeddable URL.
- **Public URL mode:** none.

### WebView Events
The embedded page posts JSON messages; the active source's `interpret()`
normalizes them (`SigningEvent`): complete, cancel, decline, sessionExpired,
error. The proxy protocol uses `{event: 'signing_complete' | ...}`; DocuSign
Web Forms uses the `sessionEnd` vocabulary (`signingResult`,
`sessionTimeout`, ...) - see [webforms-setup.md](webforms-setup.md).
