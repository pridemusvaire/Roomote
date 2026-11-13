import type { AcpConnection } from './acp-connection';
import { IdleWatchdog } from './idle-watchdog';
import { stalledOutcome, type TurnOutcome } from './turn-outcome';
import type { UpdateTranslator } from './update-translator';

/**
 * Starts the guard against an agent that went silent mid-turn: any message
 * from the agent keeps it quiet, and so does a running command, which is
 * silent by nature. Returns the function that stops it.
 */
export function startTurnWatchdog(options: {
  connection: AcpConnection;
  translator: UpdateTranslator;
  idleTimeoutMs: number;
  onStalled: (outcome: TurnOutcome) => void;
}): () => void {
  const { connection, translator } = options;
  const watchdog = new IdleWatchdog(
    options.idleTimeoutMs,
    (silentForMs) => options.onStalled(stalledOutcome(silentForMs)),
    () => translator.hasRunningTools(),
  );
  const stopListening = connection.onActivity(() => watchdog.touch());

  watchdog.start();

  return () => {
    watchdog.stop();
    stopListening();
  };
}
