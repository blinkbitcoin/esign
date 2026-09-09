// HTTP error + retry/backoff shared by every DocuSign call.

// Non-2xx response from DocuSign
export class HttpError extends Error {
  constructor(
    public status: number,
    public body: string,
  ) {
    super(`HTTP ${status}: ${body}`);
    this.name = 'HttpError';
  }
}

export interface RetryConfig {
  maxAttempts: number;
  // Delay before the second attempt; doubles on each further attempt
  baseDelay: number;
}

export const RETRY_CONFIG: RetryConfig = {
  maxAttempts: 3,
  baseDelay: 1000, // 1s, 2s, 4s exponential backoff
};

// Non-retryable client error (4xx excluding 429, which is transient)
export const isClientError = (error: unknown): boolean =>
  error instanceof HttpError &&
  error.status >= 400 &&
  error.status < 500 &&
  error.status !== 429;

// Not-found error (404)
export const isNotFoundError = (error: unknown): boolean =>
  error instanceof HttpError && error.status === 404;

// Whether an error should be retried: network errors, 5xx and 429
export const shouldRetry = (error: unknown): boolean => {
  if (!(error instanceof HttpError)) {
    return true;
  }
  return error.status >= 500 || error.status === 429;
};

export const sleep = (ms: number): Promise<void> =>
  new Promise(resolve => setTimeout(resolve, ms));

// Exponential backoff retry wrapper
export const withRetry = async <T>(
  fn: () => Promise<T>,
  config: RetryConfig = RETRY_CONFIG,
): Promise<T> => {
  let lastError: unknown = null;

  for (let attempt = 0; attempt < config.maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (!shouldRetry(error)) {
        throw error;
      }
      if (attempt < config.maxAttempts - 1) {
        await sleep(config.baseDelay * 2 ** attempt);
      }
    }
  }

  throw lastError;
};
