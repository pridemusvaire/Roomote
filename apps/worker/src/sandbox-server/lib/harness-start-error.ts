/**
 * A harness failed to start. `retryable: false` means starting it again cannot
 * succeed (missing credentials, an unsupported configuration), so a reconnect
 * loop must stop and surface the message instead of retrying with backoff.
 */
export class HarnessStartError extends Error {
  readonly retryable: boolean;

  constructor(message: string, options: { retryable: boolean }) {
    super(message);
    this.name = 'HarnessStartError';
    this.retryable = options.retryable;
  }
}

export function isUnrecoverableStartError(
  error: unknown,
): error is HarnessStartError {
  return error instanceof HarnessStartError && !error.retryable;
}
