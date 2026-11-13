import {
  TaskCommandName,
  type TaskCommand,
} from '../sandbox-server/lib/harness';

/**
 * Whether the user stopped a model fallback that was being served.
 *
 * A fallback runs from the harness's request until a harness replaces the
 * failed one (or a new turn starts). The model switch is already persisted by
 * then and stays, but a stop in that window means the user no longer wants the
 * prompt the switch would replay: it and the recovery message are dropped.
 * Only an attributed cancel counts; a steer cancels with no user behind it
 * and keeps its replay.
 */
export class FallbackStop {
  private active:
    | { stopped: boolean; recoveryCommands: Set<TaskCommand> }
    | undefined;

  /** A harness asked for a model fallback. */
  begin(): void {
    this.active = { stopped: false, recoveryCommands: new Set() };
  }

  /** The fallback is over: a harness replaced the failed one. */
  end(): void {
    this.active = undefined;
  }

  /**
   * A turn started. That ends a fallback nobody served, but not one the user
   * stopped: the stop must outlive a message sent in the window before the
   * replacement is up, or the stopped prompt would be replayed after all.
   */
  turnStarted(): void {
    if (!this.stopped) {
      this.end();
    }
  }

  get stopped(): boolean {
    return this.active?.stopped === true;
  }

  /** Remembers commands queued for the replacement harness by the fallback. */
  trackRecovery(commands: readonly TaskCommand[]): void {
    if (this.active && !this.active.stopped) {
      commands.forEach((command) => this.active!.recoveryCommands.add(command));
    }
  }

  /**
   * Notes a command sent to the harness. Returns true when it is the user
   * stop of a fallback, after taking its recovery commands out of `queue`.
   */
  stoppedBy(command: TaskCommand, queue: TaskCommand[]): boolean {
    if (
      !this.active ||
      this.active.stopped ||
      command.commandName !== TaskCommandName.CancelTask ||
      !command.data?.cancelledBy
    ) {
      return false;
    }

    this.active.stopped = true;

    for (let index = queue.length - 1; index >= 0; index -= 1) {
      if (this.active.recoveryCommands.has(queue[index]!)) {
        queue.splice(index, 1);
      }
    }

    return true;
  }
}
