/** A signal raised once and read once: `take` returns it and clears it. */
export class OneShotFlag {
  private raised = false;

  raise(): void {
    this.raised = true;
  }

  take(): boolean {
    const wasRaised = this.raised;
    this.raised = false;
    return wasRaised;
  }
}
