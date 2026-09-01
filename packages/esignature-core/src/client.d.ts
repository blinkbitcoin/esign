import { ApolloClient } from '@apollo/client/core';
import { ErrorLink } from '@apollo/client/link/error';
import { SetContextLink } from '@apollo/client/link/context';
export declare const ErrorCodes: {
  readonly ENVELOPE_NOT_FOUND: 'ENVELOPE_NOT_FOUND';
  readonly ENVELOPE_CREATION_FAILED: 'ENVELOPE_CREATION_FAILED';
  readonly PROVIDER_UNAVAILABLE: 'PROVIDER_UNAVAILABLE';
  readonly SESSION_EXPIRED: 'SESSION_EXPIRED';
  readonly UNAUTHORIZED: 'UNAUTHORIZED';
  readonly VALIDATION_ERROR: 'VALIDATION_ERROR';
  readonly PERSISTENCE_FAILED: 'PERSISTENCE_FAILED';
};
export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];
export declare const handleApolloErrors: ErrorLink.ErrorHandler;
export type GetAuthToken = () =>
  | string
  | null
  | undefined
  | Promise<string | null | undefined>;
export declare const createAuthContextSetter: (
  getAuthToken?: GetAuthToken,
) => SetContextLink.ContextSetter;
export interface ESignApolloClientOptions {
  uri: string;
  getAuthToken?: GetAuthToken;
}
export declare const createESignApolloClient: ({
  uri,
  getAuthToken,
}: ESignApolloClientOptions) => ApolloClient;
//# sourceMappingURL=client.d.ts.map
