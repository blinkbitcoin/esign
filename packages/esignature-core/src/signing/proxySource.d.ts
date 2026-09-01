import type { ApolloClient } from '@apollo/client';
import type { RecipientData } from '../types';
import type { RestartableSigningSource } from './types';
/**
 * Extract a GraphQL error code from an Apollo error. Apollo Client 4 wraps
 * server-side errors in CombinedGraphQLErrors (an `errors` array).
 */
export declare const getApolloErrorCode: (
  error: unknown,
  fallback: string,
) => string;
export interface ProxySigningSourceOptions {
  /** Apollo client wired to the e-sign backend (createESignApolloClient). */
  client: ApolloClient;
  contractType: string;
  recipient: RecipientData;
  /** Origin to accept postMessage from (web); harmless on native. */
  allowedOrigin?: string;
}
export declare const createProxySigningSource: (
  options: ProxySigningSourceOptions,
) => RestartableSigningSource;
//# sourceMappingURL=proxySource.d.ts.map
