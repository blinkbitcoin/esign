import { SigningSourceError } from '../errors';
import { withTimeout } from '../withTimeout';

const timeoutError = () => new SigningSourceError('NETWORK_ERROR', 'slow');

describe('withTimeout', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('resolves with the call result and clears the timer', async () => {
    await expect(
      withTimeout(() => Promise.resolve('ok'), 1000, timeoutError),
    ).resolves.toBe('ok');
    expect(jest.getTimerCount()).toBe(0);
  });

  it('rejects with the mapped error once the deadline passes', async () => {
    const pending = withTimeout(
      () => new Promise<never>(() => {}),
      1000,
      timeoutError,
    );
    jest.advanceTimersByTime(999);
    // Not yet: the call is still pending
    jest.advanceTimersByTime(1);
    const rejection = await pending.catch(e => e);
    expect(rejection).toBeInstanceOf(SigningSourceError);
    expect(rejection).toMatchObject({ code: 'NETWORK_ERROR', message: 'slow' });
    expect(jest.getTimerCount()).toBe(0);
  });

  it('does not fire once the call has resolved early', async () => {
    const onTimeout = jest.fn(timeoutError);
    await withTimeout(() => Promise.resolve(1), 1000, onTimeout);
    jest.advanceTimersByTime(5000);
    expect(onTimeout).not.toHaveBeenCalled();
    expect(jest.getTimerCount()).toBe(0);
  });

  it('preserves the call rejection and clears the timer', async () => {
    const boom = new Error('boom');
    await expect(
      withTimeout(() => Promise.reject(boom), 1000, timeoutError),
    ).rejects.toBe(boom);
    expect(jest.getTimerCount()).toBe(0);
  });
});
