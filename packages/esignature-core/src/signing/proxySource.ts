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
import { interpretProxyEvent } from './events';

import type { ApolloClient } from '@apollo/client';
import type { RecipientData } from '../types';
import type {
  RestartableSigningSource,
  SigningSession,
  SigningSourceError,
} from './types';

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

const toSourceError = (
  error: unknown,
  fallbackCode: string,
): SigningSourceError => ({
  code: getApolloErrorCode(error, fallbackCode),
  message: error instanceof Error ? error.message : undefined,
});

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
        throw { code: 'ENVELOPE_CREATION_FAILED' } as SigningSourceError;
      }
      return {
        url: data.createEnvelope.signingUrl,
        envelopeId: data.createEnvelope.envelopeId,
        allowedOrigin: options.allowedOrigin,
      };
    } catch (error) {
      // Re-throw an already-normalized SigningSourceError untouched
      if (error && typeof error === 'object' && 'code' in error) {
        throw error;
      }
      throw toSourceError(error, 'ENVELOPE_CREATION_FAILED');
    }
  },

  async restart(previous: SigningSession): Promise<SigningSession> {
    if (!previous.envelopeId) {
      throw { code: 'SESSION_EXPIRED' } as SigningSourceError;
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
        throw { code: 'RESTART_FAILED' } as SigningSourceError;
      }
      return {
        url: data.getSigningUrl.signingUrl,
        envelopeId: previous.envelopeId,
        allowedOrigin: options.allowedOrigin,
      };
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error) {
        throw error;
      }
      throw toSourceError(error, 'RESTART_FAILED');
    }
  },

  interpret: interpretProxyEvent,
});
