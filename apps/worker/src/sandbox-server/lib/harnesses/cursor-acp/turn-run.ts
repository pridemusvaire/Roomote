import type { TurnContext } from './turn-context';
import type { PromptData } from './turn-state';
import { CLOSEOUT_REMINDER_SOURCE } from './chat-closeout';
import { withDeveloperInstructions } from '../prompt-instructions';
import { reportModelFailure } from './model-failure';
import { startSession } from './session-start';
import { finishTurn } from './turn-finish';

/**
 * Runs one prompt: make sure a session exists, announce the prompt, pin the
 * model, run the turn, then finish it. `onIdle` runs after a completed turn
 * (it drains the follow-up queue).
 */
export async function submitPrompt(
  ctx: TurnContext,
  data: PromptData,
  isStart: boolean,
  onIdle: () => Promise<void>,
): Promise<void> {
  const { state, session, events } = ctx;
  state.inFlight = true;

  if (data.source !== CLOSEOUT_REMINDER_SOURCE) {
    state.closeoutReminders = 0;
    state.blockedCloseoutText = null;
  }

  state.workflowPhase = data.workflowPhase ?? state.workflowPhase;
  const generation = state.generation;
  state.starting = startSession(ctx, isStart, data);
  let sessionId: string | undefined;

  try {
    sessionId = await state.starting;
  } finally {
    state.starting = undefined;
  }

  if (!sessionId) {
    return;
  }

  events.userPrompt({ sessionId, ...data });

  try {
    await session.ensureModel();
  } catch (error) {
    reportModelFailure(ctx, sessionId, error, data, generation);
    return;
  }

  if (generation !== state.generation) {
    return;
  }

  // The user's prompt is already persisted as typed; only what the agent
  // receives carries the standing instructions.
  const instructions = [ctx.developerInstructions, state.restoredContext]
    .filter(Boolean)
    .join('\n\n');
  const text = session.created.take()
    ? withDeveloperInstructions(data.text, instructions)
    : data.text;
  state.restoredContext = undefined;

  state.turnPromise = runTurn(ctx, sessionId, { ...data, text }, onIdle);
  await state.turnPromise;
}

async function runTurn(
  ctx: TurnContext,
  sessionId: string,
  data: PromptData,
  onIdle: () => Promise<void>,
): Promise<void> {
  const result = await ctx.runner.run(
    sessionId,
    ctx.prompts.buildPromptBlocks(data.text, data.images),
  );

  await finishTurn(ctx, sessionId, result, onIdle, (reminder) =>
    submitPrompt(ctx, reminder, false, onIdle),
  );
}
