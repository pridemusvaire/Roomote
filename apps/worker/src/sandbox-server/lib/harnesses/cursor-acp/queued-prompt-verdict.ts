import type { QueuedPromptMessageSnapshot } from '../../harness';

import type { TurnContext } from './turn-context';
import type { QueuedPromptVerdict } from './queued-prompt-gate';

const QUEUE_RETRY_MS = 2_000;

/**
 * Acts on the worker's verdict for a prompt the drain took off the queue:
 * deliver it, drop it, or put it back to be retried or to restart the agent.
 */
export async function applyQueuedPromptVerdict(
  ctx: TurnContext,
  next: QueuedPromptMessageSnapshot,
  verdict: QueuedPromptVerdict,
  actions: {
    submit: (prompt: QueuedPromptMessageSnapshot) => Promise<void>;
    drain: () => Promise<void>;
  },
): Promise<void> {
  const { state, prompts } = ctx;

  if (verdict === 'deliver') {
    await actions.submit(next);
    return;
  }

  state.inFlight = false;

  if (verdict === 'skip') {
    await actions.drain();
    return;
  }

  prompts.restore([next, ...prompts.snapshot()], { emitUpdate: true });

  if (verdict === 'block') {
    state.retryTimer = setTimeout(() => void actions.drain(), QUEUE_RETRY_MS);
    state.retryTimer.unref?.();
  } else {
    ctx.requestRestart(verdict.reconnect, ctx.session.id);
  }
}
