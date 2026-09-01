# API Contracts - Backend

**Part:** backend
**Updated:** 2026-07-02

## Overview

The backend exposes two API surfaces:
1. **GraphQL API** - Primary client interface at `/graphql`
2. **REST Webhook** - E-sign provider callbacks at `/webhook/esign`
3. **REST Web Forms** - `POST /webform/instance` (authenticated) mints a
   prefilled DocuSign Web Forms instance via the configured provider
4. **HTML signing pages** - `GET /signing/mock/:id`, `GET /signing/mock-webform/:id`
   (mock ceremonies for E2E), `GET /signing/return` (DocuSign return-URL bridge)

## GraphQL API

### Endpoint
```
POST /graphql
Content-Type: application/json
Authorization: Bearer <token>
```

### Schema

```graphql
type Query {
  health: HealthCheck!
  envelope(id: String!): Envelope
  auditLogs(envelopeId: String!): [AuditLog!]!
}

type Mutation {
  createEnvelope(input: CreateEnvelopeInput!): EnvelopeResult!
  getSigningUrl(input: GetSigningUrlInput!): SigningUrlResult!
}

type HealthCheck {
  status: String!
  timestamp: String!
}

input RecipientInput {
  name: String!
  email: String!
}

input CreateEnvelopeInput {
  contractType: String!
  recipient: RecipientInput!
}

type EnvelopeResult {
  envelopeId: String!   # Internal UUID - never the provider's envelope ID
  signingUrl: String!
}

input GetSigningUrlInput {
  envelopeId: String!
  recipient: RecipientInput!
}

type SigningUrlResult {
  signingUrl: String!
}

# SECURITY: providerEnvelopeId is intentionally NOT exposed
type Envelope {
  id: String!
  status: String!
  contractType: String!
  createdAt: String!
}

type AuditLog {
  id: String!
  action: String!
  timestamp: String!
  metadata: String        # JSON-serialized string, null when absent
}
```

---

## Mutations

### createEnvelope

Creates a new signing envelope and returns the signing URL. The envelope and
its `initiated` audit log are persisted in a single transaction.

[![GraphQL Request Flow](../diagrams/dist/graphql-request-flow.svg)](../diagrams/src/graphql-request-flow.mmd)

**Request:**
```graphql
mutation CreateEnvelope($input: CreateEnvelopeInput!) {
  createEnvelope(input: $input) {
    envelopeId
    signingUrl
  }
}
```

**Variables:**
```json
{
  "input": {
    "contractType": "loan_agreement",
    "recipient": {
      "name": "John Doe",
      "email": "john@example.com"
    }
  }
}
```

**Response (Success):**
```json
{
  "data": {
    "createEnvelope": {
      "envelopeId": "550e8400-e29b-41d4-a716-446655440000",
      "signingUrl": "https://demo.docusign.net/Signing/..."
    }
  }
}
```

**Response (Error):**
```json
{
  "errors": [
    {
      "message": "Failed to create envelope",
      "extensions": {
        "code": "ENVELOPE_CREATION_FAILED"
      }
    }
  ]
}
```

**Validation:** `contractType` non-empty, `recipient.name` non-empty,
`recipient.email` must match a basic email format - violations return
`VALIDATION_ERROR`.

### getSigningUrl

Issues a fresh signing URL for an existing envelope (session-expiration
restart). Owner-scoped; only allowed while the envelope status is `sent`.
Logs a `session_restart` audit event.

**Request:**
```graphql
mutation GetSigningUrl($input: GetSigningUrlInput!) {
  getSigningUrl(input: $input) {
    signingUrl
  }
}
```

**Errors:** `ENVELOPE_NOT_FOUND` (missing or not owner),
`VALIDATION_ERROR` (envelope not in `sent` status, or invalid input),
`UNAUTHORIZED`.

---

## Queries

### envelope

Retrieves an envelope by internal ID. User-scoped (only owner can access);
a missing envelope and someone else's envelope are indistinguishable
(`ENVELOPE_NOT_FOUND` for both - no existence leak).

**Request:**
```graphql
query GetEnvelope($id: String!) {
  envelope(id: $id) {
    id
    status
    contractType
    createdAt
  }
}
```

**Response (Success):**
```json
{
  "data": {
    "envelope": {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "status": "completed",
      "contractType": "loan_agreement",
      "createdAt": "2026-02-01T12:00:00.000Z"
    }
  }
}
```

### auditLogs

Retrieves the audit trail for an envelope, newest first. User-scoped via the
parent envelope. `metadata` is returned as a JSON-serialized string.

**Request:**
```graphql
query GetAuditLogs($envelopeId: String!) {
  auditLogs(envelopeId: $envelopeId) {
    id
    action
    timestamp
    metadata
  }
}
```

---

## Error Codes

Defined in `src/errors.ts`; every GraphQL error carries `extensions.code`.

| Code | Meaning |
|------|---------|
| `UNAUTHORIZED` | No authenticated userId in context |
| `VALIDATION_ERROR` | Invalid input (message is user-presentable) |
| `ENVELOPE_NOT_FOUND` | Envelope missing or not owned by caller |
| `ENVELOPE_CREATION_FAILED` | Provider rejected envelope creation (4xx) |
| `PROVIDER_UNAVAILABLE` | E-sign provider unreachable/failing (after retries) |
| `SESSION_EXPIRED` | Signing session has expired |
| `PERSISTENCE_FAILED` | Envelope created at provider but DB write failed |

---

## REST Endpoints

### Health Check

```
GET /health
```

**Response:**
```json
{
  "status": "ok",
  "timestamp": "2026-07-02T12:00:00.000Z"
}
```

### E-Sign Provider Webhook

```
POST /webhook/esign
Content-Type: application/json
```

Provider-agnostic endpoint: signature verification and payload parsing are
delegated to the configured provider (`provider.verifyWebhook` /
`provider.parseWebhookEvent`). For DocuSign (and the mock, which mirrors it),
the signature is HMAC-SHA256 of the raw body in the
`X-DocuSign-Signature-1` header, keyed by `DOCUSIGN_HMAC_KEY`.

**Request Body (DocuSign Connect format):**
```json
{
  "event": "envelope-completed",
  "apiVersion": "v2.1",
  "data": {
    "accountId": "...",
    "userId": "...",
    "envelopeId": "provider-envelope-id",
    "envelopeSummary": {
      "status": "completed",
      "emailSubject": "Please sign this document"
    }
  }
}
```

**Responses:**
| Status | Body | When |
|--------|------|------|
| `200` | `{ "received": true }` | Processed - including idempotent duplicates, unknown envelopes, and untracked statuses (no retry wanted) |
| `400` | `{ "error": "Invalid payload" }` | Malformed JSON or missing required fields |
| `401` | `{ "error": "Unauthorized" }` | Signature verification failed |
| `500` | `{ "error": "Processing failed" }` | Transient failure (e.g. DB outage) - provider should retry; handler is idempotent |

**Supported statuses:**
| Status | Result |
|--------|--------|
| `completed` | Envelope status → completed |
| `voided` | Envelope status → voided |
| `declined` | Envelope status → declined |
| `sent` | Envelope status → sent (audit action `initiated`) |
| anything else | Acknowledged with 200 and ignored |

Every applied status change writes the envelope update and its audit log in
a single database transaction.

---

## Authentication

### Bearer tokens (`src/auth.ts`)

```typescript
interface GraphQLContext {
  userId: string | null;
}
```

| Configuration | Behavior |
|---------------|----------|
| `JWT_SECRET` set | Token verified as HS256 JWT (signature, expiry); `sub` claim → `userId`; invalid → `userId: null` |
| `JWT_SECRET` unset, development | Bearer token used as opaque `userId` (dev passthrough, warns once) |
| `JWT_SECRET` unset, production | Fail closed - `userId: null` for every request |

Resolvers reject `userId: null` with `UNAUTHORIZED`.

### Webhook Security

1. Provider extracts its signature header and secret
2. Shared HMAC-SHA256 validation over the **raw** request body
   (timing-safe comparison)
3. Missing key: dev allows with warning; **production rejects (fail-closed)**

---

## Status Values

| Status | Description |
|--------|-------------|
| `sent` | Envelope created, awaiting signature |
| `completed` | Successfully signed |
| `voided` | Cancelled by sender |
| `declined` | Declined by recipient |

---

## Audit Log Actions

| Action | Trigger |
|--------|---------|
| `initiated` | Envelope created (or re-sent status via webhook) |
| `completed` | Signing completed (webhook) |
| `failed` | Operation failed |
| `voided` | Envelope voided (webhook) |
| `declined` | Signature declined (webhook) |
| `session_restart` | New signing URL issued for existing envelope |
| `creation_failed` | Provider envelope creation failed |
