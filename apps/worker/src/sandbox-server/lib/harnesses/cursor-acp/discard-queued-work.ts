import type { TurnContext } from './turn-context';

/**
 * A steer keeps the queue, and the prompt a drain is still checking goes back
 * into it right behind the steer, which sits at the front. A stop or close
 * drops both, so a stopped prompt is never delivered.
 */
export function discardQueuedWork(ctx: TurnContext, keepPrompts = false): void {
  const { state, prompts } = ctx;
  const claimed = state.claimedPrompt;
  state.generation += 1;
  state.claimedPrompt = undefined;
  clearTimeout(state.retryTimer);
  ctx.session.stopRetrying();

  if (!keepPrompts) {
    prompts.clear();
  } else if (claimed) {
    const [steer, ...rest] = prompts.snapshot();
    prompts.restore(steer ? [steer, claimed, ...rest] : [claimed], {
      emitUpdate: true,
    });
  }
}
