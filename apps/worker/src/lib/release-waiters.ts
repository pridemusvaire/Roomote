/** Callers parked until something is released, each able to give up early. */
export class ReleaseWaiters {
  private readonly waiters = new Set<() => void>();

  /** Resolves `true` on `releaseAll`, `false` if `signal` aborts first. */
  wait(signal?: AbortSignal): Promise<boolean> {
    if (signal?.aborted) {
      return Promise.resolve(false);
    }

    return new Promise((resolve) => {
      const onRelease = () => {
        signal?.removeEventListener('abort', onAbort);
        resolve(true);
      };
      const onAbort = () => {
        this.waiters.delete(onRelease);
        resolve(false);
      };

      this.waiters.add(onRelease);
      signal?.addEventListener('abort', onAbort, { once: true });
    });
  }

  releaseAll(): void {
    this.waiters.forEach((resolve) => resolve());
    this.waiters.clear();
  }
}
