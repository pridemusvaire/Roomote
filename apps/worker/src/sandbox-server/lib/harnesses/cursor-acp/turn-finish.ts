import { judgeCloseout } from './chat-closeout';
import { failForQuota } from './quota-failure';
import { failTurn } from './fail-turn';
import type { TurnContext } from './turn-context';
import type { PromptData } from './turn-state';
import type { TurnResult } from './turn-outcome';

function describeAbnormalEnd(result: TurnResult): string {
  if (result.message) {
    return result.message;
  }

  return result.kind === 'closed'
    ? 'The Cursor agent process exited unexpectedly.'
    : 'The Cursor agent cancelled the turn unexpectedly.';
}

/**
 * Settles a turn that has produced its result. A completed turn reports its
 * final message and completion, then `onIdle` drains the follow-up queue;
 * anything else fails the task. A chat task whose turn ended with no reply
 * posted is sent a hidden reminder (`remind`) instead of completing.
 */
export async function finishTurn(
  ctx: TurnContext,
  sessionId: string,
  result: TurnResult,
  onIdle: () => Promise<void>,
  remind: (prompt: PromptData) => Promise<void>,
): Promise<void> {
  // A cancel owns the end of the turn: it emits the marker and the abort.
  if (ctx.isDisposed() || ctx.state.cancelling) {
    return;
  }

  if (result.quota) {
    failForQuota(ctx, sessionId, result.message);
    return;
  }

  if (result.kind !== 'completed') {
    failTurn(ctx, sessionId, describeAbnormalEnd(result));
    return;
  }

  const verdict = judgeCloseout(ctx, result.text);

  if (verdict.kind === 'remind') {
    await remind(verdict.prompt);
    return;
  }

  ctx.state.inFlight = false;

  if (verdict.text.trim().length > 0) {
    ctx.events.turnCompleted(sessionId, verdict.text);
  }

  ctx.events.taskCompleted(
    sessionId,
    undefined,
    verdict.missingCloseout
      ? { missingChatCloseout: verdict.missingCloseout }
      : {},
  );
  await onIdle();
}
