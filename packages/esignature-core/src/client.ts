// Apollo Client factory for the e-signature backend.
// The host app owns the endpoint URL and token retrieval; this module owns
// the link chain (error logging + auth header) and the error-code contract.

import { ApolloClient, InMemoryCache, from } from '@apollo/client/core';
import { HttpLink } from '@apollo/client/link/http';
import { ErrorLink } from '@apollo/client/link/error';
import { SetContextLink } from '@apollo/client/link/context';
import { CombinedGraphQLErrors } from '@apollo/client/errors';

// Error codes shared with the backend (extensions.code on GraphQL errors).
// The wire contract is the ErrorCode enum in apps/api/schema.graphql; a parity
// test checks this map against the generated enum (src/generated/error-code.ts).
export const ErrorCodes = {
  ENVELOPE_NOT_FOUND: 'ENVELOPE_NOT_FOUND',
  ENVELOPE_CREATION_FAILED: 'ENVELOPE_CREATION_FAILED',
  PROVIDER_UNAVAILABLE: 'PROVIDER_UNAVAILABLE',
  SESSION_EXPIRED: 'SESSION_EXPIRED',
  UNAUTHORIZED: 'UNAUTHORIZED',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  PERSISTENCE_FAILED: 'PERSISTENCE_FAILED',
} as const;

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];

// Error handling link callback - logs GraphQL/network errors with codes.
// Apollo Client 4 wraps server-side GraphQL errors in `CombinedGraphQLErrors`
// (an `errors` array) rather than the old `{graphQLErrors, networkError}` shape.
export const handleApolloErrors: ErrorLink.ErrorHandler = ({ error }) => {
  if (CombinedGraphQLErrors.is(error)) {
    error.errors.forEach(({ message, extensions }) => {
      console.error(`[GraphQL error]: ${extensions?.code} - ${message}`);
    });
  } else {
    console.error(`[Network error]: ${error}`);
  }
};

// Returns the bearer token to attach to requests, or null/undefined for
// unauthenticated requests. May be async (e.g. secure-storage reads).
export type GetAuthToken = () =>
  | string
  | null
  | undefined
  | Promise<string | null | undefined>;

// Builds the SetContextLink context setter that attaches the auth header.
// Exported for direct testing.
export const createAuthContextSetter =
  (getAuthToken?: GetAuthToken): SetContextLink.ContextSetter =>
  async ({ headers }) => {
    const token = getAuthToken ? await getAuthToken() : null;
    return {
      headers: {
        ...headers,
        authorization: token ? `Bearer ${token}` : '',
      },
    };
  };

export interface ESignApolloClientOptions {
  // The backend GraphQL endpoint, e.g. https://api.example.com/graphql
  uri: string;
  // Token provider; omit for unauthenticated (dev) usage
  getAuthToken?: GetAuthToken;
}

// Creates an ApolloClient wired for the e-signature backend:
// errorLink -> authLink -> httpLink. Pass the result to <ApolloProvider>.
export const createESignApolloClient = ({
  uri,
  getAuthToken,
}: ESignApolloClientOptions): ApolloClient => {
  return new ApolloClient({
    link: from([
      new ErrorLink(handleApolloErrors),
      new SetContextLink(createAuthContextSetter(getAuthToken)),
      new HttpLink({ uri }),
    ]),
    cache: new InMemoryCache(),
  });
};
