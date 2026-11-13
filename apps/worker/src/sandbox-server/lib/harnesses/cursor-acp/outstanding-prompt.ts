const noop = () => {};

/**
 * Tracks the `session/prompt` request the agent has not answered yet. A turn
 * that was abandoned (idle watchdog, a cancel the agent never acknowledged)
 * leaves its request running, and a new prompt sent into the same session
 * meanwhile would interleave with it.
 */
export class OutstandingPrompt {
  private current: Promise<void> | null = null;

  track(request: Promise<unknown>): void {
    const settled = request.then(noop, noop);
    this.current = settled;
    void settled.then(() => {
      if (this.current === settled) {
        this.current = null;
      }
    });
  }

  /** True once nothing is outstanding; false if it outlived the grace. */
  async settled(graceMs: number): Promise<boolean> {
    const pending = this.current;

    if (!pending) {
      return true;
    }

    let timer: NodeJS.Timeout | undefined;
    const outcome = await Promise.race([
      pending.then(() => true),
      new Promise<boolean>((resolve) => {
        timer = setTimeout(() => resolve(false), graceMs);
      }),
    ]);
    clearTimeout(timer);
    return outcome;
  }
}
