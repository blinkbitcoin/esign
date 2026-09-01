// GraphQL operations for e-signature flow.
// The gql documents are duplicated across the client packages (KEPT IN SYNC);
// all TYPES are generated from apps/api/schema.graphql - see codegen.ts.

import { gql } from '@apollo/client/core';

export const CREATE_ENVELOPE_MUTATION = gql`
  mutation CreateEnvelope($input: CreateEnvelopeInput!) {
    createEnvelope(input: $input) {
      envelopeId
      signingUrl
    }
  }
`;

// Get signing URL mutation for session restart (expired sessions restart
// with a fresh URL for the SAME envelope - no duplicate envelope creation)
export const GET_SIGNING_URL_MUTATION = gql`
  mutation GetSigningUrl($input: GetSigningUrlInput!) {
    getSigningUrl(input: $input) {
      signingUrl
    }
  }
`;

// Re-export generated types under the package's established public names
export type {
  CreateEnvelopeInput,
  GetSigningUrlInput,
} from './generated/graphql';
export type {
  CreateEnvelopeMutation as CreateEnvelopeResult,
  GetSigningUrlMutation as GetSigningUrlResult,
} from './generated/graphql';
