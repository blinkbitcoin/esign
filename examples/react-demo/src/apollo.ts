// Demo Apollo wiring: the library owns the link chain, the host app owns
// the endpoint and token retrieval (same split as the RN demo).
import { createESignApolloClient } from '@blinkbitcoin/esign-react';

import { GRAPHQL_URL } from './config';

// No login flow exists yet; the backend's dev passthrough (JWT_SECRET
// unset) treats this fixed token as the userId.
export const getAuthToken = (): string => 'mock-jwt-token';

export const apolloClient = createESignApolloClient({
  uri: GRAPHQL_URL,
  getAuthToken,
});
