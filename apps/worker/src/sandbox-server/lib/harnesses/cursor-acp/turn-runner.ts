import { randomUUID } from 'node:crypto';

import type { AcpConnection } from './acp-connection';
import { OutstandingPrompt } from './outstanding-prompt';
import { sendPrompt } from './send-prompt';
import {
  outcomeFromError,
  type TurnOutcome,
  type TurnResult,
} from './turn-outcome';
import { STUCK_MESSAGE, type TurnRunnerOptions } from './turn-runner-options';
import { startTurnWatchdog } from './turn-watchdog';
import type { UpdateTranslator } from './update-translator';

/**
 * Runs one `session/prompt` turn: wires streamed updates through the
 * translator, guards against a silent agent, and always flushes buffered
 * output before returning, whatever ended the turn.
 */
export class TurnRunner {
  private turnCount = 0;
  /** Keeps turn ids unique across harness restarts on the same session. */
  private readonly runId = randomUUID().slice(0, 8);
  private abandonCurrent: ((outcome: TurnOutcome) => void) | null = null;
  /** Aborted when the turn ends or is cancelled, which stops any retry. */
  private stopRetrying = new AbortController();
  private readonly outstanding = new OutstandingPrompt();

  constructor(
    private readonly connection: AcpConnection,
    private readonly translator: UpdateTranslator,
    private readonly options: TurnRunnerOptions,
  ) {}

  async run(
    sessionId: string,
    prompt: Array<Record<string, unknown>>,
  ): Promise<TurnResult> {
    if (!(await this.outstanding.settled(this.options.settleGraceMs))) {
      this.options.onStuck(sessionId);
      return { kind: 'failed', text: '', message: STUCK_MESSAGE };
    }

    this.translator.beginTurn(
      sessionId,
      `cursor-${this.runId}-turn-${++this.turnCount}`,
    );
    const ended = (this.stopRetrying = new AbortController());
    const abandoned = new Promise<TurnOutcome>((resolve) => {
      this.abandonCurrent = resolve;
    });
    const stopWatching = startTurnWatchdog({
      connection: this.connection,
      translator: this.translator,
      idleTimeoutMs: this.options.idleTimeoutMs,
      onStalled: (outcome) => {
        this.cancel(sessionId);
        this.abandon(outcome);
      },
    });
    let outcome: TurnOutcome;

    try {
      outcome = await Promise.race([
        sendPrompt({
          connection: this.connection,
          outstanding: this.outstanding,
          sessionId,
          prompt,
          signal: ended.signal,
          activity: () => this.translator.activity.count,
          tuning: this.options,
        }),
        abandoned,
      ]);
    } catch (error) {
      outcome = outcomeFromError(error, this.connection.isClosed);
    } finally {
      ended.abort();
      stopWatching();
      this.abandonCurrent = null;
    }

    const text = this.translator.flush();
    this.translator.endTurn();
    return { ...outcome, text };
  }

  /** Asks the agent to stop; the prompt then resolves as `cancelled`. */
  cancel(sessionId: string): void {
    this.stopRetrying.abort();
    this.connection.notify('session/cancel', { sessionId });
  }

  /** Ends the running turn now, without waiting for the agent. */
  abandon(outcome: TurnOutcome): void {
    this.abandonCurrent?.(outcome);
  }
}
