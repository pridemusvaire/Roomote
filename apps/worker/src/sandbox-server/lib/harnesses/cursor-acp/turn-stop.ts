import type { TurnContext } from './turn-context';

/** Cancels the running turn and waits (bounded) for its output to flush. */
export async function stopTurn(
  ctx: TurnContext,
  sessionId: string,
): Promise<void> {
  const { state, runner } = ctx;
  let timer: NodeJS.Timeout | undefined;

  state.cancelling = true;
  runner.cancel(sessionId);
  await Promise.race([
    state.turnPromise,
    new Promise<void>((resolve) => {
      timer = setTimeout(resolve, ctx.cancelGraceMs);
    }),
  ]);
  clearTimeout(timer);
  runner.abandon({ kind: 'cancelled' });
  await state.turnPromise;
  state.cancelling = false;
}
