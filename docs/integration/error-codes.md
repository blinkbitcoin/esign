# Error Codes

Every failure surfaces through `onError({ code, message })` with a stable
`code` and a user-presentable `message` (from `getErrorMessage`, which also
accepts unknown codes and degrades to a generic message). Codes come from
two layers:

## Schema-borne codes (produced by the backend, proxy mode)

The `ErrorCode` GraphQL enum in `apps/api/schema.graphql` is the wire
contract; client packages generate types from it and parity tests fail on
drift.

| Code | Meaning | Sensible host reaction |
|------|---------|------------------------|
| `ENVELOPE_CREATION_FAILED` | Provider rejected envelope/instance creation (bad template, bad recipient) | Show the retry UI (built in); check template config if persistent |
| `ENVELOPE_NOT_FOUND` | Session restart referenced an unknown envelope | Retry from scratch |
| `PERSISTENCE_FAILED` | Envelope created but could not be saved | Retry; safe - creation is idempotent per attempt |
| `PROVIDER_UNAVAILABLE` | DocuSign (or the provider) is down/erroring | Retry later; alert if persistent |
| `SESSION_EXPIRED` | The signing ceremony URL expired (~5 min TTL) | Built-in Restart button handles it (proxy mode restarts in place) |
| `UNAUTHORIZED` | Bearer token missing/invalid | Re-authenticate the user |
| `VALIDATION_ERROR` | Input rejected (message is user-friendly) | Show `message` as-is |

## Client-side codes (produced by the packages, all modes)

| Code | Produced when | Sensible host reaction |
|------|--------------|------------------------|
| `NETWORK_ERROR` | Device offline, or `createWebFormsSource`'s `createInstance` exceeded `timeoutMs` (default 30 s) | Built-in connectivity UI handles it |
| `RESTART_FAILED` | A restartable source could not mint a fresh session URL | Retry from scratch |
| `SIGNING_ERROR` | The embedded page reported an exception, or a DocuSign.js mount failed without a code | Retry; inspect the signing page if persistent |
| `UNKNOWN_ERROR` | Anything uncoded (unexpected exception shape) | Generic retry |

**Declines are not errors:** a signer choosing "Decline to Sign" flows
through `onCancel`, not `onError` - the component treats it as a signer
decision, like cancel.

Message copy for every code lives in `getErrorMessage`
(`@blinkbitcoin/esign-core`), which hosts can also call directly to render
their own error surfaces consistently.
