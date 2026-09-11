import {
  HttpError,
  isClientError,
  isNotFoundError,
  RETRY_CONFIG,
  shouldRetry,
  sleep,
  withRetry,
} from '../http';

describe('HttpError', () => {
  it('stores status and body', () => {
    const error = new HttpError(404, 'Not Found');
    expect(error.status).toBe(404);
    expect(error.body).toBe('Not Found');
    expect(error.message).toBe('HTTP 404: Not Found');
    expect(error.name).toBe('HttpError');
  });
});

describe('error classification', () => {
  it('treats 4xx except 429 as client errors, 404 as not found', () => {
    expect(isClientError(new HttpError(400, ''))).toBe(true);
    expect(isClientError(new HttpError(404, ''))).toBe(true);
    expect(isClientError(new HttpError(429, ''))).toBe(false);
    expect(isClientError(new HttpError(500, ''))).toBe(false);
    expect(isClientError(new Error('network'))).toBe(false);
    expect(isNotFoundError(new HttpError(404, ''))).toBe(true);
    expect(isNotFoundError(new HttpError(400, ''))).toBe(false);
    expect(isNotFoundError('nope')).toBe(false);
  });

  it('retries network errors, 5xx and 429, never other 4xx', () => {
    expect(shouldRetry(new Error('network'))).toBe(true);
    expect(shouldRetry(new HttpError(503, ''))).toBe(true);
    expect(shouldRetry(new HttpError(429, ''))).toBe(true);
    expect(shouldRetry(new HttpError(400, ''))).toBe(false);
    expect(shouldRetry(new HttpError(401, ''))).toBe(false);
  });
});

describe('withRetry', () => {
  const fast = { maxAttempts: 3, baseDelay: 1 };

  it('has the documented defaults', () => {
    expect(RETRY_CONFIG).toEqual({ maxAttempts: 3, baseDelay: 1000 });
  });

  it('returns the first successful result', async () => {
    const fn = jest.fn().mockResolvedValue('ok');
    expect(await withRetry(fn, fast)).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries a network error and a 5xx, then succeeds', async () => {
    const fn = jest
      .fn()
      .mockRejectedValueOnce(new Error('network'))
      .mockRejectedValueOnce(new HttpError(502, 'bad gateway'))
      .mockResolvedValueOnce('third time');
    expect(await withRetry(fn, fast)).toBe('third time');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('gives up after maxAttempts with the last error', async () => {
    const fn = jest.fn().mockRejectedValue(new HttpError(500, 'down'));
    await expect(withRetry(fn, fast)).rejects.toThrow('HTTP 500: down');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('does not retry a client error', async () => {
    const fn = jest.fn().mockRejectedValue(new HttpError(400, 'bad'));
    await expect(withRetry(fn, fast)).rejects.toThrow('HTTP 400');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('backs off exponentially between attempts', async () => {
    const timer = jest.spyOn(global, 'setTimeout');
    const fn = jest
      .fn()
      .mockRejectedValueOnce(new HttpError(429, ''))
      .mockRejectedValueOnce(new HttpError(429, ''))
      .mockResolvedValueOnce('ok');
    await withRetry(fn, { maxAttempts: 3, baseDelay: 2 });
    const delays = timer.mock.calls.map(call => call[1]);
    expect(delays).toEqual([2, 4]);
    timer.mockRestore();
  });

  it('uses the default config when none is given', async () => {
    const fn = jest.fn().mockResolvedValue('ok');
    expect(await withRetry(fn)).toBe('ok');
  });

  it('sleep resolves after the delay', async () => {
    const started = Date.now();
    await sleep(5);
    expect(Date.now() - started).toBeGreaterThanOrEqual(4);
  });
});
