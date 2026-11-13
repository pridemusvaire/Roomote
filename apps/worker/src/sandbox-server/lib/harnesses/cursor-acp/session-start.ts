import { describeAcpError } from './acp-error-detail';
import { announceSession } from './session-announce';
import { failSessionStart } from './session-failure';
import type { TurnContext } from './turn-context';
import type { PromptData } from './turn-state';

const CONTEXT_LOST_NOTE =
  "Prior Cursor context could not be restored, so this continues in a new Cursor session. Earlier work in this task is no longer in the agent's memory.";

/** The conversation so far for a replacement session; never throws. */
async function restoreContext(
  ctx: TurnContext,
  prompt: PromptData,
): Promise<string | undefined> {
  try {
    return await ctx.restoreContext?.({
      text: prompt.text,
      hidden: prompt.visibleInTranscript === false,
    });
  } catch (error) {
    ctx.log.warn(
      `Could not rebuild the lost session's context: ${describeAcpError(error)}`,
    );
    return undefined;
  }
}

/**
 * Makes sure the agent has a session for the next prompt and announces it.
 * Returns undefined when the turn must not go on (the failure is already
 * reported, or a cancel superseded this start). `prompt` never reached the
 * agent if this fails, so a plan-limit fallback replays it.
 */
export async function startSession(
  ctx: TurnContext,
  isStart: boolean,
  prompt: PromptData,
): Promise<string | undefined> {
  const { state, session } = ctx;
  const generation = state.generation;
  const previousSessionId = session.id;
  let sessionId: string;

  try {
    sessionId = await session.ensure();
  } catch (error) {
    state.inFlight = false;

    if (generation === state.generation) {
      failSessionStart(ctx, error, prompt);
    }

    return undefined;
  }

  // A new session id (first start, or a session that could not be loaded)
  // must be announced, or the manager drops everything emitted under it. A
  // cancel that raced the start still needs it announced before its abort.
  announceSession(ctx, sessionId, isStart || sessionId !== previousSessionId);

  if (generation !== state.generation) {
    return undefined;
  }

  if (session.loadFailed.take()) {
    ctx.log.warn(`Cursor session could not be restored; using ${sessionId}`);
    ctx.events.assistantMessage({ sessionId, text: CONTEXT_LOST_NOTE });
    state.restoredContext = await restoreContext(ctx, prompt);
  }

  return generation === state.generation ? sessionId : undefined;
}
