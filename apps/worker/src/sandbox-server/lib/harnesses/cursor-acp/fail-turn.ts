import { emitTerminalError } from './terminal-error';
import type { TurnContext } from './turn-context';

/** Ends the task with a visible, unrecoverable error. */
export function failTurn(
  ctx: TurnContext,
  sessionId: string,
  text: string,
): void {
  ctx.state.inFlight = false;
  ctx.prompts.clear();
  clearTimeout(ctx.state.retryTimer);
  ctx.log.error(`Failing task: ${text}`);
  emitTerminalError(ctx.events, sessionId, text);
}

/**
 * Fails the task because the agent stopped answering, then asks for its
 * process to be restarted: a wedged agent cannot serve the next message.
 */
export function failWedgedAgent(
  ctx: TurnContext,
  sessionId: string,
  detail: string,
): void {
  const text = `The Cursor agent stopped responding (${detail}) and is being restarted.`;
  failTurn(ctx, sessionId, text);
  ctx.requestRestart(text, sessionId);
}
