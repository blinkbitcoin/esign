// Shared types for the service. The domain types (recipients, envelope
// statuses, webhook events, prefill) are the package's; only the GraphQL
// context is the service's own.

export type {
  CreateEnvelopeInput,
  EnvelopeResult,
  EnvelopeStatus,
  ESignProvider,
  GetSigningUrlInput,
  RecipientData,
  SigningUrlResult,
  WebFormInstanceResult,
  WebFormPhoneNumber,
  WebFormPrefill,
  WebFormPrefillValue,
  WebhookEvent,
  WebhookHeaders,
} from '@blinkbitcoin/esign-server';

// Context type for Apollo Server resolvers
export interface GraphQLContext {
  userId: string | null;
}
