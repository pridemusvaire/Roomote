import { discardQueuedWork } from './discard-queued-work';
import type { TurnContext } from './turn-context';
import { stopTurn } from './turn-stop';

interface CancelledBy {
  name?: string;
  source?: string;
}

/**
 * `onIdle` replays the follow-up queue. An unattributed cancel that
 * interrupts a turn is a steer (prioritize, then cancel, since this harness
 * cannot steer natively): the queued prompt must run next, with no abort
 * reported. An attributed cancel is a user stop and drops the queue.
 */
export async function cancelTurn(
  ctx: TurnContext,
  cancelledBy: CancelledBy | undefined,
  onIdle: () => Promise<void>,
): Promise<void> {
  const { state, events } = ctx;
  const hadActiveTurn = state.inFlight;
  // A drain awaiting its check, or a model switch, has no turn to interrupt:
  // a stop leaves no marker for it, and a steer still keeps its queue.
  const hadRunningTurn = hadActiveTurn && !state.claimedPrompt;
  const isSteer =
    !cancelledBy &&
    (hadActiveTurn || state.switching) &&
    ctx.prompts.hasQueuedMessages();
  discardQueuedWork(ctx, isSteer);

  // A pending model switch survives a user stop, which only drops the queue
  // above: the model is exhausted, so a message sent now must wait for the
  // replacement harness, not run on it. The switch always ends the harness's
  // life, in a reconnect that replaces it (the worker drops the stopped
  // prompt's replay itself) or in `failTask` (see
  // `createModelFallbackHandler`), so `switching` cannot stick.
  // A cancel that lands while the session is still being created (or loaded)
  // waits for it: the session is announced to the manager before the abort,
  // so a steer's follow-up is not dropped and later turns are not ignored.
  await state.starting?.catch(() => undefined);
  const sessionId = ctx.session.id;

  if (!sessionId) {
    state.inFlight = false;

    if (isSteer) {
      await onIdle();
    }

    return;
  }

  if (hadActiveTurn) {
    await stopTurn(ctx, sessionId);
  }

  state.inFlight = false;

  if (isSteer) {
    await onIdle();
    return;
  }

  // Only an explicit user stop that interrupted a running turn leaves a marker.
  if (cancelledBy && hadRunningTurn) {
    events.taskCancelled({
      sessionId,
      cancelledByName: cancelledBy.name,
      source: cancelledBy.source,
    });
  }

  events.taskAborted(sessionId);
}

/** CloseTask: stop quietly, with no marker and no abort. */
export async function closeTurn(ctx: TurnContext): Promise<void> {
  discardQueuedWork(ctx);

  if (ctx.state.inFlight && ctx.session.id) {
    await stopTurn(ctx, ctx.session.id);
  }

  ctx.state.inFlight = false;
}
