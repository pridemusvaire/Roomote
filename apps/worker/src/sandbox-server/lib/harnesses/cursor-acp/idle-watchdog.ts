/** How many idle timeouts of silence a running command may take at most. */
const MAX_BUSY_TIMEOUTS = 4;

/**
 * Fires `onIdle` once, with how long the agent has been silent, if `touch()`
 * is not called within `timeoutMs`. While `isBusy` says work is in progress
 * that is silent by nature (a long command), a lapse re-arms the timer
 * instead of firing, but only up to `MAX_BUSY_TIMEOUTS` timeouts since the
 * last `touch()`: a command that never reports back must not hold the turn
 * forever.
 */
export class IdleWatchdog {
  private timer: NodeJS.Timeout | undefined;
  private lastTouchAt = 0;

  constructor(
    private readonly timeoutMs: number,
    private readonly onIdle: (silentForMs: number) => void,
    private readonly isBusy: () => boolean = () => false,
  ) {}

  start(): void {
    this.touch();
  }

  touch(): void {
    this.lastTouchAt = Date.now();
    this.arm();
  }

  stop(): void {
    clearTimeout(this.timer);
    this.timer = undefined;
  }

  private arm(): void {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      if (this.isBusy() && !this.busyForTooLong()) {
        this.arm();
        return;
      }

      this.onIdle(Date.now() - this.lastTouchAt);
    }, this.timeoutMs);
    this.timer.unref?.();
  }

  private busyForTooLong(): boolean {
    return Date.now() - this.lastTouchAt >= this.timeoutMs * MAX_BUSY_TIMEOUTS;
  }
}
