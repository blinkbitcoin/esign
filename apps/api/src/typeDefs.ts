// GraphQL SDL - kept free of runtime imports so tooling (schema emission,
// drift tests, client codegen) can load it without a database connection.

// GraphQL type definitions
export const typeDefs = `#graphql
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

  # Envelope type for status queries
  # SECURITY: providerEnvelopeId is intentionally NOT included - never expose provider IDs
  type Envelope {
    id: String!
    status: String!
    contractType: String!
    createdAt: String!
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
    envelopeId: String!
    signingUrl: String!
  }

  input GetSigningUrlInput {
    envelopeId: String!
    recipient: RecipientInput!
  }

  type SigningUrlResult {
    signingUrl: String!
  }

  # Audit log entry for tracking envelope actions
  type AuditLog {
    id: String!
    action: String!
    timestamp: String!
    metadata: String
  }

  # Error codes returned in GraphQL error extensions.code - the wire contract
  # shared with the client packages (their generated code and ErrorCodes maps
  # are checked against this enum)
  enum ErrorCode {
    ENVELOPE_NOT_FOUND
    ENVELOPE_CREATION_FAILED
    PROVIDER_UNAVAILABLE
    SESSION_EXPIRED
    UNAUTHORIZED
    VALIDATION_ERROR
    PERSISTENCE_FAILED
  }
`;
