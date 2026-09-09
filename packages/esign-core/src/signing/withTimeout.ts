// A watchdog around an async call: the caller's promise races a timer, and
// the timer is always cleared - a resolved call leaves no pending handle
// behind (it would keep a Node process or a test runner alive).

import type { SigningSourceError } from './errors';

/**
 * Run `run()` and reject with `onTimeout()` if it has not settled within
 * `ms`. Resolves/rejects with the call's own outcome otherwise; the timer is
 * cleared either way.
 */
export const withTimeout = async <T>(
  run: () => Promise<T>,
  ms: number,
  onTimeout: () => SigningSourceError,
): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      run(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(onTimeout()), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
};
