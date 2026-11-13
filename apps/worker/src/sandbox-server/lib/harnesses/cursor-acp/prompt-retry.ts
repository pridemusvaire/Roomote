import { classifyCursorError } from './quota-classifier';

/** Waits before each retry of a throttled prompt: three retries, then fail. */
export const RATE_LIMIT_BACKOFF_MS: readonly number[] = [5_000, 15_000, 45_000];

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(done, ms);
    signal.addEventListener('abort', done, { once: true });

    function done() {
      clearTimeout(timer);
      signal.removeEventListener('abort', done);
      resolve();
    }
  });
}

/**
 * Sends a request, retrying while the agent answers with a transient rate
 * limit. Any other error, an exhausted budget or an abort (the turn ended)
 * rethrows the last error, so the caller fails it as a normal provider error.
 */
export async function withRateLimitRetry<T>(options: {
  send: () => Promise<T>;
  backoffMs: readonly number[];
  signal: AbortSignal;
  onRetry: (attempt: number, delayMs: number) => void;
}): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await options.send();
    } catch (error) {
      const delayMs = options.backoffMs[attempt];

      if (
        delayMs === undefined ||
        options.signal.aborted ||
        classifyCursorError(error) !== 'rate-limit'
      ) {
        throw error;
      }

      options.onRetry(attempt + 1, delayMs);
      await sleep(delayMs, options.signal);

      if (options.signal.aborted) {
        throw error;
      }
    }
  }
}
