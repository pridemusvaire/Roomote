import type { CommandHandlers } from './command-router';
import { isPlaceholderSessionId } from './placeholder-session';
import { announceSession } from './session-announce';
import { cancelTurn, closeTurn } from './turn-cancel';
import type { TurnContext } from './turn-context';
import type { PromptData } from './turn-state';
import { drainQueuedPrompts, sendMessage } from './turn-queue';
import { submitPrompt } from './turn-run';

/** Binds the turn flows (submit, queue, cancel) into command handlers. */
export function createCommandHandlers(ctx: TurnContext): CommandHandlers {
  const drain = (): Promise<void> =>
    drainQueuedPrompts(ctx, (next) => submit(next));
  const submit = (data: PromptData, isStart = false): Promise<void> =>
    submitPrompt(ctx, data, isStart, drain);

  return {
    start: (data) => submit(data, true),
    send: (data) => sendMessage(ctx, data, submit),
    cancel: (cancelledBy) => cancelTurn(ctx, cancelledBy, drain),
    close: () => closeTurn(ctx),
    resume: (sessionId) => {
      if (isPlaceholderSessionId(sessionId)) {
        return;
      }

      ctx.session.resume(sessionId);
      announceSession(ctx, sessionId, true);
    },
  };
}
