import { SigningSourceError } from '../../../signing/errors';
import { isRestartable } from '../../../signing/types';
import { createPublicUrlSource, createWebFormsSource } from '../webFormsSource';

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
    const rejection = await source.start().catch(e => e);
    expect(rejection).toBeInstanceOf(SigningSourceError);
    expect(rejection).toMatchObject({
      code: 'ENVELOPE_CREATION_FAILED',
      message: 'http 500',
    });
  });

  it('start() keeps the code of an already-coded createInstance rejection', async () => {
    const source = createWebFormsSource({
      createInstance: jest
        .fn()
        .mockRejectedValue(new SigningSourceError('UNAUTHORIZED', 'no')),
    });
    await expect(source.start()).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
      message: 'no',
    });
  });

  it('start() handles a non-Error rejection (no message)', async () => {
    const source = createWebFormsSource({
      createInstance: jest.fn().mockRejectedValue('nope'),
    });
    await expect(source.start()).rejects.toMatchObject({
      code: 'ENVELOPE_CREATION_FAILED',
      message: '',
    });
  });

  it('start() times out a hung createInstance with NETWORK_ERROR', async () => {
    jest.useFakeTimers();
    const source = createWebFormsSource({
      createInstance: jest.fn().mockReturnValue(new Promise(() => {})),
      timeoutMs: 5000,
    });
    const started = source.start();
    jest.advanceTimersByTime(5000);
    const rejection = await started.catch(e => e);
    expect(rejection).toBeInstanceOf(SigningSourceError);
    expect(rejection).toMatchObject({
      code: 'NETWORK_ERROR',
      message: expect.stringContaining('5000ms'),
    });
    jest.useRealTimers();
  });

  it('start() defaults the timeout to 30s', async () => {
    jest.useFakeTimers();
    const source = createWebFormsSource({
      createInstance: jest.fn().mockReturnValue(new Promise(() => {})),
    });
    const started = source.start();
    jest.advanceTimersByTime(30_000);
    await expect(started).rejects.toMatchObject({
      code: 'NETWORK_ERROR',
    });
    jest.useRealTimers();
  });

  it('start() clears the watchdog when createInstance resolves in time', async () => {
    jest.useFakeTimers();
    const source = createWebFormsSource({
      createInstance: jest.fn().mockResolvedValue({ url: 'https://wf/2' }),
      timeoutMs: 5000,
    });
    await expect(source.start()).resolves.toMatchObject({
      url: 'https://wf/2',
    });
    expect(jest.getTimerCount()).toBe(0);
    jest.useRealTimers();
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
