// Proxy signing source: backend creates the envelope via the GraphQL API and
// returns an embedded signing URL. The only source that depends on Apollo -
// so @apollo/client / graphql are peer deps of THIS mode, not the component.

import { CombinedGraphQLErrors } from '@apollo/client/errors';

import {
  CREATE_ENVELOPE_MUTATION,
  GET_SIGNING_URL_MUTATION,
  type CreateEnvelopeInput,
  type CreateEnvelopeResult,
  type GetSigningUrlInput,
  type GetSigningUrlResult,
} from '../operations';
import { interpretBridgeEvent } from './bridge';
import { SigningSourceError, isSigningSourceError } from './errors';

import type { ApolloClient } from '@apollo/client';
import type { RecipientData } from '../types';
import type { RestartableSigningSource, SigningSession } from './types';

/**
 * Extract a GraphQL error code from an Apollo error. Apollo Client 4 wraps
 * server-side errors in CombinedGraphQLErrors (an `errors` array).
 */
export const getApolloErrorCode = (
  error: unknown,
  fallback: string,
): string => {
  if (CombinedGraphQLErrors.is(error)) {
    return (
      (error.errors[0]?.extensions?.code as string | undefined) || fallback
    );
  }
  return fallback;
};

// Re-throw an already-normalized SigningSourceError untouched; otherwise map
// the Apollo error onto a code (falling back to the caller's).
const toSourceError = (
  error: unknown,
  fallbackCode: string,
): SigningSourceError =>
  isSigningSourceError(error)
    ? error
    : new SigningSourceError(
        getApolloErrorCode(error, fallbackCode),
        error instanceof Error ? error.message : undefined,
      );

export interface ProxySigningSourceOptions {
  /** Apollo client wired to the e-sign backend (createESignApolloClient). */
  client: ApolloClient;
  contractType: string;
  recipient: RecipientData;
  /** Origin to accept postMessage from (web); harmless on native. */
  allowedOrigin?: string;
}

export const createProxySigningSource = (
  options: ProxySigningSourceOptions,
): RestartableSigningSource => ({
  async start(): Promise<SigningSession> {
    try {
      const { data } = await options.client.mutate<
        CreateEnvelopeResult,
        { input: CreateEnvelopeInput }
      >({
        mutation: CREATE_ENVELOPE_MUTATION,
        variables: {
          input: {
            contractType: options.contractType,
            recipient: options.recipient,
          },
        },
      });
      if (!data?.createEnvelope) {
        throw new SigningSourceError('ENVELOPE_CREATION_FAILED');
      }
      return {
        url: data.createEnvelope.signingUrl,
        envelopeId: data.createEnvelope.envelopeId,
        allowedOrigin: options.allowedOrigin,
      };
    } catch (error) {
      throw toSourceError(error, 'ENVELOPE_CREATION_FAILED');
    }
  },

  async restart(previous: SigningSession): Promise<SigningSession> {
    if (!previous.envelopeId) {
      throw new SigningSourceError('SESSION_EXPIRED');
    }
    try {
      const { data } = await options.client.mutate<
        GetSigningUrlResult,
        { input: GetSigningUrlInput }
      >({
        mutation: GET_SIGNING_URL_MUTATION,
        variables: {
          input: {
            envelopeId: previous.envelopeId,
            recipient: options.recipient,
          },
        },
      });
      if (!data?.getSigningUrl) {
        throw new SigningSourceError('RESTART_FAILED');
      }
      return {
        url: data.getSigningUrl.signingUrl,
        envelopeId: previous.envelopeId,
        allowedOrigin: options.allowedOrigin,
      };
    } catch (error) {
      throw toSourceError(error, 'RESTART_FAILED');
    }
  },

  // The backend's return-URL bridge posts the `{ event }` protocol
  interpret: interpretBridgeEvent,
});
