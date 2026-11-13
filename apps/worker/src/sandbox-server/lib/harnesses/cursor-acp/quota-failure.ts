import { summarizeOpenCodeProviderError } from '../opencode-server/provider-error-recovery';

import { failTurn } from './fail-turn';
import type { ModelFallbackRequest } from './harness-options';
import type { TurnContext } from './turn-context';

const TERMINAL_NOTICE_TAIL =
  "Check your Cursor plan's usage, or set a coding fallback model so tasks can continue when it runs out.";

/**
 * Handles a Cursor plan-limit failure. The prompt is never retried. With a
 * coding fallback configured the worker is asked to relaunch on it, as it is
 * for an OpenCode provider usage-limit error, and the queue is kept for the
 * replacement harness. `replayPrompt` is the prompt that never reached the
 * model, for the replacement to run. Without a fallback (or once this model's
 * one allowed switch was attempted, even by an earlier harness) the task ends
 * with a terminal provider error.
 */
export function failForQuota(
  ctx: TurnContext,
  sessionId: string,
  detail: string | undefined,
  replayPrompt?: ModelFallbackRequest['replayPrompt'],
): void {
  const { state, fallback } = ctx;
  const model = ctx.requestedModel ?? 'the selected Cursor model';
  const notice = `Cursor plan limit reached for ${model}. ${TERMINAL_NOTICE_TAIL}`;
  const attempt = fallback && `${fallback.role}:${fallback.activeModelId}`;

  if (
    !fallback ||
    !attempt ||
    fallback.attempts.has(attempt) ||
    fallback.fallbackModel === fallback.activeModelId
  ) {
    failTurn(ctx, sessionId, notice);
    return;
  }

  fallback.attempts.add(attempt);
  state.inFlight = false;
  state.switching = true;
  ctx.log.warn(`Cursor plan limit reached; requesting fallback: ${detail}`);
  ctx.events.assistantMessage({
    sessionId,
    text: `Cursor plan limit reached for ${model}. Switching to ${fallback.fallbackModel}.`,
  });
  ctx.requestFallback({
    role: fallback.role,
    fromModelId: fallback.activeModelId,
    toModelId: fallback.fallbackModel,
    toReasoningEffort: fallback.fallbackReasoningEffort ?? null,
    // The router rejects a summary over 280 characters, which would fail the
    // switch and leave the task on the model that just ran out.
    errorSummary: summarizeOpenCodeProviderError({ message: detail ?? notice }),
    trigger: 'immediate',
    sessionId: ctx.session.id,
    ...(replayPrompt ? { replayPrompt } : {}),
  });
}
