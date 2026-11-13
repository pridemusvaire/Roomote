import type { SendMessageCommand } from '../../harness';

import { describeUnknownError } from '../logging';

import { checkQueuedPrompt } from './queued-prompt-gate';
import { applyQueuedPromptVerdict } from './queued-prompt-verdict';
import type { TurnContext } from './turn-context';
import type { PromptData } from './turn-state';

type Submit = (data: PromptData) => Promise<void>;

/** Delivers a follow-up now, or queues it behind the running turn. */
export async function sendMessage(
  ctx: TurnContext,
  data: SendMessageCommand['data'],
  submit: Submit,
): Promise<void> {
  const prompt = { ...data, text: data.text ?? '' };

  if (!data.queueOnly && !ctx.state.inFlight && !ctx.state.switching) {
    await submit(prompt);
    return;
  }

  const id = ctx.prompts.enqueue(prompt);

  // No native steering: a steer goes to the front of the queue and the
  // caller cancels the running turn so it is delivered next.
  if (data.autoSteerWhenQueued && !data.queueOnly) {
    ctx.prompts.prioritize(id);
  }
}

/**
 * Sends the next queued prompt, if the worker allows it right now. While the
 * prompt awaits that check a cancel or close may take it over (see
 * `claimedPrompt`): a stop drops it, a steer has already put it back behind
 * the steer, so either way the drain lets go and delivers nothing.
 */
export async function drainQueuedPrompts(
  ctx: TurnContext,
  submit: Submit,
): Promise<void> {
  const { state, prompts } = ctx;

  if (state.inFlight || state.switching || ctx.isDisposed()) {
    return;
  }

  const next = prompts.dequeue();

  if (!next) {
    return;
  }

  state.inFlight = true;
  state.claimedPrompt = next;
  const verdict = await checkQueuedPrompt(ctx.beforeQueuedPrompt, next).catch(
    (error: unknown) => {
      ctx.log.warn(
        `Queued prompt check failed; will retry: ${describeUnknownError(error)}`,
      );
      return 'block' as const;
    },
  );

  if (state.claimedPrompt !== next || ctx.isDisposed()) {
    return;
  }

  state.claimedPrompt = undefined;
  await applyQueuedPromptVerdict(ctx, next, verdict, {
    submit,
    drain: () => drainQueuedPrompts(ctx, submit),
  });
}
