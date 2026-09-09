import { SigningSourceError } from '../../errors';
import { isRestartable } from '../../types';
import {
  createHostedFormSource,
  resolveHostedFormCreateInstance,
} from '../source';

const reply = (status: number, json: unknown) =>
  ({ ok: status < 300, status, json: async () => json }) as Response;

describe('createHostedFormSource', () => {
  it('is not restartable', () => {
    expect(
      isRestartable(createHostedFormSource({ createInstance: jest.fn() })),
    ).toBe(false);
  });

  it('start() returns the host-minted instance with the allowed origin', async () => {
    const source = createHostedFormSource({
      createInstance: jest
        .fn()
        .mockResolvedValue({ url: 'https://form/1', envelopeId: 'inst-1' }),
      allowedOrigin: 'https://forms.example',
    });
    await expect(source.start()).resolves.toEqual({
      url: 'https://form/1',
      envelopeId: 'inst-1',
      allowedOrigin: 'https://forms.example',
    });
  });

  it('start() mints through the endpoint with the given prefill', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValue(reply(200, { url: 'https://form/2' }));
    const source = createHostedFormSource({
      mint: {
        url: 'https://api/form',
        getAuthToken: () => 'jwt',
        fetch: fetchImpl,
      },
      prefill: { any: { shape: 1 } },
    });
    await expect(source.start()).resolves.toMatchObject({
      url: 'https://form/2',
    });
    expect(fetchImpl.mock.calls[0][1].body).toBe(
      JSON.stringify({ prefill: { any: { shape: 1 } } }),
    );
  });

  it('start() wraps a failing createInstance as ENVELOPE_CREATION_FAILED', async () => {
    const source = createHostedFormSource({
      createInstance: jest.fn().mockRejectedValue(new Error('http 500')),
    });
    const rejection = await source.start().catch(e => e);
    expect(rejection).toBeInstanceOf(SigningSourceError);
    expect(rejection).toMatchObject({
      code: 'ENVELOPE_CREATION_FAILED',
      message: 'http 500',
    });
  });

  it('start() times out a hung createInstance with NETWORK_ERROR', async () => {
    jest.useFakeTimers();
    const source = createHostedFormSource({
      createInstance: jest.fn().mockReturnValue(new Promise(() => {})),
      timeoutMs: 1000,
    });
    const started = source.start();
    jest.advanceTimersByTime(1000);
    await expect(started).rejects.toMatchObject({
      code: 'NETWORK_ERROR',
      message: expect.stringContaining('1000ms'),
    });
    jest.useRealTimers();
  });

  it('reads the bridge protocol by default', () => {
    const source = createHostedFormSource({ createInstance: jest.fn() });
    expect(source.interpret({ event: 'signing_complete' })).toEqual({
      type: 'complete',
    });
    // ...and nothing else: a provider binds its own vocabulary on top
    expect(source.interpret({ type: 'signingResult' })).toBeNull();
  });

  it('uses the injected interpreter', () => {
    const interpret = jest.fn().mockReturnValue({ type: 'cancel' });
    const source = createHostedFormSource({
      createInstance: jest.fn(),
      interpret,
    });
    expect(source.interpret('anything')).toEqual({ type: 'cancel' });
    expect(interpret).toHaveBeenCalledWith('anything');
  });
});

describe('resolveHostedFormCreateInstance', () => {
  it('keeps a host-provided createInstance as is', () => {
    const createInstance = async () => ({ url: 'mine' });
    expect(resolveHostedFormCreateInstance({ createInstance })).toBe(
      createInstance,
    );
  });

  it('builds a minter for the mint + prefill shape', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(reply(200, { url: 'u' }));
    const createInstance = resolveHostedFormCreateInstance({
      mint: { url: 'x', getAuthToken: () => 't', fetch: fetchImpl },
    });
    await expect(createInstance()).resolves.toEqual({
      url: 'u',
      envelopeId: undefined,
    });
  });
});
