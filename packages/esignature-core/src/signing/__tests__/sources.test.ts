import { CombinedGraphQLErrors } from '@apollo/client/errors';

import { createProxySigningSource, getApolloErrorCode } from '../proxySource';
import { createWebFormsSource } from '../webFormsSource';
import { createPublicUrlSource } from '../publicUrlSource';
import { isRestartable } from '../types';

import type { ApolloClient } from '@apollo/client';

const recipient = { name: 'Jane Doe', email: 'jane@example.com' };

// Minimal ApolloClient stub - only .mutate is used by the proxy source
const mockClient = (mutate: jest.Mock): ApolloClient =>
  ({ mutate }) as unknown as ApolloClient;

describe('getApolloErrorCode', () => {
  it('extracts the code from a CombinedGraphQLErrors', () => {
    const error = new CombinedGraphQLErrors({
      data: null,
      errors: [{ message: 'x', extensions: { code: 'UNAUTHORIZED' } }],
    } as never);
    expect(getApolloErrorCode(error, 'FALLBACK')).toBe('UNAUTHORIZED');
  });

  it('falls back for non-Apollo errors', () => {
    expect(getApolloErrorCode(new Error('network'), 'FALLBACK')).toBe(
      'FALLBACK',
    );
  });

  it('falls back when an Apollo error carries no code', () => {
    const error = new CombinedGraphQLErrors({
      data: null,
      errors: [{ message: 'x' }],
    } as never);
    expect(getApolloErrorCode(error, 'FALLBACK')).toBe('FALLBACK');
  });
});

describe('createProxySigningSource', () => {
  it('is restartable', () => {
    expect(
      isRestartable(
        createProxySigningSource({
          client: mockClient(jest.fn()),
          contractType: 'c',
          recipient,
        }),
      ),
    ).toBe(true);
  });

  it('start() creates an envelope and returns url + envelopeId', async () => {
    const mutate = jest.fn().mockResolvedValue({
      data: {
        createEnvelope: { envelopeId: 'env-1', signingUrl: 'https://sign/1' },
      },
    });
    const source = createProxySigningSource({
      client: mockClient(mutate),
      contractType: 'loan',
      recipient,
      allowedOrigin: 'https://x',
    });

    await expect(source.start()).resolves.toEqual({
      url: 'https://sign/1',
      envelopeId: 'env-1',
      allowedOrigin: 'https://x',
    });
    expect(mutate).toHaveBeenCalledWith(
      expect.objectContaining({
        variables: { input: { contractType: 'loan', recipient } },
      }),
    );
  });

  it('start() throws a coded error when the mutation rejects', async () => {
    const error = new CombinedGraphQLErrors({
      data: null,
      errors: [
        { message: 'boom', extensions: { code: 'PROVIDER_UNAVAILABLE' } },
      ],
    } as never);
    const source = createProxySigningSource({
      client: mockClient(jest.fn().mockRejectedValue(error)),
      contractType: 'c',
      recipient,
    });
    await expect(source.start()).rejects.toMatchObject({
      code: 'PROVIDER_UNAVAILABLE',
    });
  });

  it('start() throws ENVELOPE_CREATION_FAILED when data is empty', async () => {
    const source = createProxySigningSource({
      client: mockClient(jest.fn().mockResolvedValue({ data: null })),
      contractType: 'c',
      recipient,
    });
    await expect(source.start()).rejects.toMatchObject({
      code: 'ENVELOPE_CREATION_FAILED',
    });
  });

  it('start() handles a non-Error, non-coded rejection', async () => {
    const source = createProxySigningSource({
      client: mockClient(jest.fn().mockRejectedValue('weird')),
      contractType: 'c',
      recipient,
    });
    await expect(source.start()).rejects.toEqual({
      code: 'ENVELOPE_CREATION_FAILED',
      message: undefined,
    });
  });

  it('restart() gets a fresh url for the preserved envelope', async () => {
    const mutate = jest.fn().mockResolvedValue({
      data: { getSigningUrl: { signingUrl: 'https://sign/again' } },
    });
    const source = createProxySigningSource({
      client: mockClient(mutate),
      contractType: 'c',
      recipient,
    });

    await expect(
      source.restart({ url: 'old', envelopeId: 'env-1' }),
    ).resolves.toEqual({
      url: 'https://sign/again',
      envelopeId: 'env-1',
      allowedOrigin: undefined,
    });
  });

  it('restart() without an envelopeId throws SESSION_EXPIRED', async () => {
    const source = createProxySigningSource({
      client: mockClient(jest.fn()),
      contractType: 'c',
      recipient,
    });
    await expect(source.restart({ url: 'old' })).rejects.toMatchObject({
      code: 'SESSION_EXPIRED',
    });
  });

  it('restart() throws RESTART_FAILED on empty data', async () => {
    const source = createProxySigningSource({
      client: mockClient(jest.fn().mockResolvedValue({ data: {} })),
      contractType: 'c',
      recipient,
    });
    await expect(
      source.restart({ url: 'old', envelopeId: 'env-1' }),
    ).rejects.toMatchObject({ code: 'RESTART_FAILED' });
  });

  it('restart() maps a rejecting mutation to a coded error', async () => {
    const source = createProxySigningSource({
      client: mockClient(jest.fn().mockRejectedValue(new Error('net'))),
      contractType: 'c',
      recipient,
    });
    await expect(
      source.restart({ url: 'old', envelopeId: 'env-1' }),
    ).rejects.toMatchObject({ code: 'RESTART_FAILED' });
  });

  it('uses interpretProxyEvent', () => {
    const source = createProxySigningSource({
      client: mockClient(jest.fn()),
      contractType: 'c',
      recipient,
    });
    expect(source.interpret({ event: 'signing_complete' })).toEqual({
      type: 'complete',
    });
  });
});

describe('createWebFormsSource', () => {
  it('is not restartable', () => {
    expect(
      isRestartable(createWebFormsSource({ createInstance: jest.fn() })),
    ).toBe(false);
  });

  it('start() returns the host-minted instance url', async () => {
    const createInstance = jest
      .fn()
      .mockResolvedValue({ url: 'https://wf/1', envelopeId: 'inst-1' });
    const source = createWebFormsSource({
      createInstance,
      allowedOrigin: 'https://apps.docusign.com',
    });

    await expect(source.start()).resolves.toEqual({
      url: 'https://wf/1',
      envelopeId: 'inst-1',
      allowedOrigin: 'https://apps.docusign.com',
    });
  });

  it('start() wraps a failing createInstance as a coded error', async () => {
    const source = createWebFormsSource({
      createInstance: jest.fn().mockRejectedValue(new Error('http 500')),
    });
    await expect(source.start()).rejects.toMatchObject({
      code: 'ENVELOPE_CREATION_FAILED',
      message: 'http 500',
    });
  });

  it('start() handles a non-Error rejection (no message)', async () => {
    const source = createWebFormsSource({
      createInstance: jest.fn().mockRejectedValue('nope'),
    });
    await expect(source.start()).rejects.toEqual({
      code: 'ENVELOPE_CREATION_FAILED',
      message: undefined,
    });
  });

  it('uses interpretDocuSignEvent', () => {
    const source = createWebFormsSource({ createInstance: jest.fn() });
    expect(
      source.interpret({ event: 'sessionEnd', type: 'signingResult' }),
    ).toMatchObject({
      type: 'complete',
    });
  });
});

describe('createPublicUrlSource', () => {
  it('is not restartable', () => {
    expect(isRestartable(createPublicUrlSource({ url: 'https://form' }))).toBe(
      false,
    );
  });

  it('start() returns the static url', async () => {
    const source = createPublicUrlSource({
      url: 'https://form?x=1',
      allowedOrigin: 'https://apps.docusign.com',
    });
    await expect(source.start()).resolves.toEqual({
      url: 'https://form?x=1',
      allowedOrigin: 'https://apps.docusign.com',
    });
  });

  it('uses interpretDocuSignEvent', () => {
    const source = createPublicUrlSource({ url: 'https://form' });
    expect(source.interpret({ type: 'cancel' })).toEqual({ type: 'cancel' });
  });
});
