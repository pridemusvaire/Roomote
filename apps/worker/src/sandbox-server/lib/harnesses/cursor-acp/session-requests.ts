import type { AcpConnection } from './acp-connection';
import type { CursorLog } from './acp-types';
import { withRateLimitRetry } from './prompt-retry';

/**
 * Sends the requests that set a session up (`session/new`, `session/load`,
 * `session/set_model`), retrying a transient rate limit with backoff. A
 * throttled setup would otherwise fail the task, or silently replace the
 * session the task should have continued. `stopRetrying` ends a retry that is
 * waiting, so a cancel is not held up behind it.
 */
export class SessionRequests {
  private retrying = new AbortController();

  constructor(
    private readonly connection: AcpConnection,
    private readonly options: {
      rateLimitBackoffMs: readonly number[];
      log: CursorLog;
    },
  ) {}

  request<T>(method: string, params: unknown, timeoutMs: number): Promise<T> {
    return withRateLimitRetry({
      send: () => this.connection.request<T>(method, params, { timeoutMs }),
      backoffMs: this.options.rateLimitBackoffMs,
      signal: this.retrying.signal,
      onRetry: (attempt, delayMs) =>
        this.options.log.warn(
          `Cursor rate limit on ${method}; retrying in ${delayMs}ms (attempt ${attempt})`,
        ),
    });
  }

  stopRetrying(): void {
    this.retrying.abort();
    this.retrying = new AbortController();
  }
}
