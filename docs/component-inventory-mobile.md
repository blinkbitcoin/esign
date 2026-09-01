# Component Inventory - Mobile

**Parts:** `packages/esign-react-native` (library) + `examples/react-native-demo` (host)
**Updated:** 2026-07-02

## Overview

The mobile app is intentionally small: one screen hosting a single reusable
feature component. There is no navigation library, global state store, or
design system — the `ESignature` component is the product.

## Component Catalog

### Demo Host Components (`examples/react-native-demo/App.tsx`)

| Component | Type | Purpose |
|-----------|------|---------|
| `App` | Root (default export) | Wraps the tree in `ApolloProvider` + `SafeAreaProvider`, sets `StatusBar` bar style from `useColorScheme()` |
| `AppContent` | Layout | Applies safe-area top inset, renders `ESignature` with demo props |

Exported handlers (extracted for direct testability):

| Function | Purpose |
|----------|---------|
| `getRecipientData()` | Returns the dev/E2E test recipient (`__DEV__`-gated) |
| `handleSigningComplete(result)` | Success alert with envelope ID |
| `handleSigningError(error)` | Logs code + message (UI already shows error state) |
| `handleSigningCancel()` | Cancellation alert |

### Library Components (`packages/esign-react-native/src/`)

| Export | Type | Purpose |
|--------|------|---------|
| `ESignature` | Feature component | Complete signing flow state machine |
| `getApolloErrorCode(error, fallback)` | Utility | Extracts `extensions.code` from Apollo Client 4 `CombinedGraphQLErrors` |
| `getErrorMessage(code, serverMessage?)` | Utility | Maps error codes to user-friendly copy |

**`ESignature` props** (see `types.ts`): the component is provider-agnostic -
it takes a `SigningSource` (proxy envelope / DocuSign Web Forms / public URL;
from `@blinkbitcoin/esignature-core`) rather than knowing about contracts or Apollo directly.

```typescript
interface ESignatureProps {
  source: SigningSource;            // createProxySigningSource / createWebFormsSource / createPublicUrlSource
  label?: string;                   // idle title + button, default "Sign Document"
  onComplete: (result: { envelopeId?: string; status: string }) => void;
  onError: (error: { code: string; message: string }) => void;
  onCancel: () => void;
  successDelayMs?: number;          // default 1500
  __testInitialStatus?: ESignatureStatus;  // test-only state injection
  __testSigningUrl?: string;
  __testSession?: SigningSession;
}
```

The signing modes (in `@blinkbitcoin/esignature-core`, platform-agnostic,
shared with the web package): `createProxySigningSource` (Apollo - the only Apollo-dependent mode,
restartable), `createWebFormsSource` (host mints the instance URL),
`createPublicUrlSource` (static URL). Adding a provider = a new `SigningSource`;
the component never changes.

## ESignature Render States

One component, six rendered views, driven by a status enum
(`idle | loading | signing | success | error | offline`):

| Status | View | Key elements (testIDs) |
|--------|------|------------------------|
| `idle` | Sign prompt | `sign-document-button`, `cancel-button` |
| `loading` | Spinner | `loading-indicator` |
| `signing` | Embedded WebView | `signing-webview` (falls back to a text view if no URL) |
| `success` | Confirmation | `success-screen`, `success-text` |
| `error` | Error + recovery | `error-text`, `error-message`, `retry-button` **or** `restart-button` (session expiry preserves the envelope ID for restart) |
| `offline` | Connectivity prompt | `offline-text`, `check-connection-button` (disabled state shows "Checking...") |

The Maestro E2E flow (`examples/react-native-demo/.maestro/sign-document-happy-path.yaml`) drives the
happy path through these testIDs: idle → loading → signing → success.

## Design Elements

- **Styling:** `StyleSheet.create()` per component; no shared theme module
- **Accessibility:** every interactive element has `accessibilityRole` +
  `accessibilityLabel`; status colors chosen for WCAG AA contrast
  (success `#1E7E34`, error `#C82333`, warning `#F0AD4E`)
- **Safe areas:** `react-native-safe-area-context` (`useSafeAreaInsets`)
- **Primary action color:** iOS blue `#007AFF`

## Test Doubles (`packages/esign-react-native/__mocks__/` + `examples/react-native-demo/__mocks__/`)

Not shipped components, but part of the component contract:

| Mock | Replaces | Notes |
|------|----------|-------|
| `react-native-webview.tsx` | WebView | Registers the `onMessage` handler on `globalThis` so tests can post signing events (`simulateWebViewMessage`, `simulateRawWebViewMessage`) |
| `@react-native-community/netinfo.ts` | NetInfo | Controllable connectivity state |
| `react-native-safe-area-context.tsx` | SafeAreaProvider/insets | Zero insets, fixed frame (official mock has a circular-import bug in v5.6+) |

## Reuse Guidance

`ESignature` ships as the `@blinkbitcoin/esign-react-native` package: self-contained
state machine, typed props, no assumptions about navigation or host screen.
To embed in another app: `npm install @blinkbitcoin/esign-react-native` (plus the
native peer deps), build a source (e.g. `createProxySigningSource({ client,
contractType, recipient })` with a client from `createESignApolloClient`), and
render `<ESignature source={source} onComplete onError onCancel />`.
See `examples/react-native-demo/` for a complete working host.
