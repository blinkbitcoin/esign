// KEPT IN SYNC with packages/esign-react-native/src/__tests__/client.test.ts
/**
 * Apollo Client factory tests
 */

import { CombinedGraphQLErrors } from '@apollo/client/errors';

import {
  createESignApolloClient,
  createAuthContextSetter,
  ErrorCodes,
  handleApolloErrors,
} from '../client';
import * as operations from '../operations';
import * as api from '../index';

// Mock console.error to verify error logging
const originalConsoleError = console.error;

describe('createESignApolloClient', () => {
  it('creates a client with link chain and cache', () => {
    const client = createESignApolloClient({
      uri: 'http://example.test/graphql',
    });

    expect(client).toBeDefined();
    expect(client.link).toBeDefined();
    expect(typeof client.link.request).toBe('function');
    expect(client.cache).toBeDefined();
  });

  it('accepts a token provider', () => {
    const client = createESignApolloClient({
      uri: 'http://example.test/graphql',
      getAuthToken: () => 'a-token',
    });

    expect(client.link).toBeDefined();
  });
});

describe('ErrorCodes (backend wire contract)', () => {
  it('exports the shared error codes', () => {
    expect(ErrorCodes.ENVELOPE_NOT_FOUND).toBe('ENVELOPE_NOT_FOUND');
    expect(ErrorCodes.ENVELOPE_CREATION_FAILED).toBe(
      'ENVELOPE_CREATION_FAILED',
    );
    expect(ErrorCodes.PROVIDER_UNAVAILABLE).toBe('PROVIDER_UNAVAILABLE');
    expect(ErrorCodes.SESSION_EXPIRED).toBe('SESSION_EXPIRED');
    expect(ErrorCodes.UNAUTHORIZED).toBe('UNAUTHORIZED');
    expect(ErrorCodes.VALIDATION_ERROR).toBe('VALIDATION_ERROR');
  });
});

describe('createAuthContextSetter (authLink)', () => {
  it('attaches a Bearer authorization header from the token provider', async () => {
    const setter = createAuthContextSetter(() => 'mock-jwt-token');

    const context = await setter(
      { headers: { 'content-type': 'application/json' } },
      {} as never,
    );

    expect(context.headers).toEqual({
      'content-type': 'application/json',
      authorization: 'Bearer mock-jwt-token',
    });
  });

  it('supports async token providers', async () => {
    const setter = createAuthContextSetter(async () => 'async-token');

    const context = await setter({ headers: {} }, {} as never);

    expect(context.headers).toMatchObject({
      authorization: 'Bearer async-token',
    });
  });

  it('sends an empty authorization header without a token provider', async () => {
    const setter = createAuthContextSetter();

    const context = await setter({ headers: {} }, {} as never);

    expect(context.headers).toMatchObject({ authorization: '' });
  });

  it('sends an empty authorization header when the provider returns null', async () => {
    const setter = createAuthContextSetter(() => null);

    const context = await setter({ headers: {} }, {} as never);

    expect(context.headers).toMatchObject({ authorization: '' });
  });

  it('preserves existing headers when adding authorization', async () => {
    const setter = createAuthContextSetter(() => 'token');

    const context = await setter(
      { headers: { 'x-custom': 'value' } },
      {} as never,
    );

    expect(context.headers).toMatchObject({ 'x-custom': 'value' });
  });
});

describe('handleApolloErrors (errorLink)', () => {
  beforeEach(() => {
    console.error = jest.fn();
  });

  afterEach(() => {
    console.error = originalConsoleError;
  });

  it('logs each GraphQL error with its code and message', () => {
    const error = new CombinedGraphQLErrors({ data: null }, [
      {
        message: 'Envelope not found',
        extensions: { code: 'ENVELOPE_NOT_FOUND' },
      },
      { message: 'Second error', extensions: { code: 'SECOND_CODE' } },
    ]);

    handleApolloErrors({ error } as never);

    expect(console.error).toHaveBeenCalledWith(
      '[GraphQL error]: ENVELOPE_NOT_FOUND - Envelope not found',
    );
    expect(console.error).toHaveBeenCalledWith(
      '[GraphQL error]: SECOND_CODE - Second error',
    );
    expect(console.error).toHaveBeenCalledTimes(2);
  });

  it('logs a network error for non-GraphQL errors', () => {
    const networkError = new Error('Network connection failed');

    handleApolloErrors({ error: networkError } as never);

    expect(console.error).toHaveBeenCalledWith(
      '[Network error]: Error: Network connection failed',
    );
  });
});

describe('operations', () => {
  it('exports CREATE_ENVELOPE_MUTATION', () => {
    expect(operations.CREATE_ENVELOPE_MUTATION).toBeDefined();
    expect(operations.CREATE_ENVELOPE_MUTATION.kind).toBe('Document');
  });

  it('exports GET_SIGNING_URL_MUTATION', () => {
    expect(operations.GET_SIGNING_URL_MUTATION).toBeDefined();
    expect(operations.GET_SIGNING_URL_MUTATION.kind).toBe('Document');
  });
});

describe('public API (index)', () => {
  it('exports the client factory, contract, sources, and operations', () => {
    expect(api.createESignApolloClient).toBeDefined();
    expect(api.createAuthContextSetter).toBeDefined();
    expect(api.handleApolloErrors).toBeDefined();
    expect(api.ErrorCodes).toBeDefined();
    expect(api.getErrorMessage).toBeDefined();
    expect(api.getApolloErrorCode).toBeDefined();
    expect(api.CREATE_ENVELOPE_MUTATION).toBeDefined();
    expect(api.GET_SIGNING_URL_MUTATION).toBeDefined();
    // Signing sources live in core (the component is in the platform packages)
    expect(api.createProxySigningSource).toBeDefined();
    expect(api.createWebFormsSource).toBeDefined();
    expect(api.createPublicUrlSource).toBeDefined();
    expect(api.isRestartable).toBeDefined();
  });
});
