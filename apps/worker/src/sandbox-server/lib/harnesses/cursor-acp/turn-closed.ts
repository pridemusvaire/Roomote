import type { TurnContext } from './turn-context';

/**
 * The agent process went away. An in-flight turn is ended as `closed` and
 * allowed to surface its terminal error before the owner reacts to
 * `disconnected` by tearing the harness down.
 */
export async function settleTurnBeforeDisconnect(
  ctx: TurnContext,
): Promise<void> {
  if (ctx.state.inFlight) {
    ctx.runner.abandon({ kind: 'closed' });
    await ctx.state.turnPromise;
  }
}

/** Disposal ends everything silently: no error, no retry. */
export function stopTurnsForDispose(ctx: TurnContext): void {
  clearTimeout(ctx.state.retryTimer);
  ctx.session.stopRetrying();
  ctx.runner.abandon({ kind: 'closed' });
}
