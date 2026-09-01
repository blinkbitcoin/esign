// Demo app Apollo wiring: the library owns the link chain, the host app
// (this demo) owns the endpoint and token retrieval.

import { createESignApolloClient } from '@blinkbitcoin/esign-react-native';

import { GRAPHQL_URL } from './config';

// No login flow exists yet, so the demo sends a fixed dev token; the
// backend's dev passthrough (JWT_SECRET unset) treats it as the userId.
// A real host app would read a JWT from secure storage here.
export const getAuthToken = (): string => 'mock-jwt-token';

export const apolloClient = createESignApolloClient({
  uri: GRAPHQL_URL,
  getAuthToken,
});
