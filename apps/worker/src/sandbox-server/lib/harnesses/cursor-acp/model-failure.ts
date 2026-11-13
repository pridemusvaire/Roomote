import { describeAcpError } from './acp-error-detail';
import { AcpTimeoutError } from './acp-rpc-error';
import { failTurn, failWedgedAgent } from './fail-turn';
import { isCursorQuotaError } from './quota-classifier';
import { failForQuota } from './quota-failure';
import type { TurnContext } from './turn-context';
import type { PromptData } from './turn-state';

/**
 * Reports a failure to pin the session's model. Nothing is reported for a
 * turn a stop or close already ended: that aborts a waiting set_model retry,
 * which rethrows its last error, and the user's choice is not a failure (nor,
 * for a plan limit, a reason to switch models).
 */
export function reportModelFailure(
  ctx: TurnContext,
  sessionId: string,
  error: unknown,
  data: PromptData,
  generation: number,
): void {
  if (generation !== ctx.state.generation || ctx.isDisposed()) {
    return;
  }

  if (isCursorQuotaError(error)) {
    // The prompt is already in the transcript; only the model never saw it.
    failForQuota(ctx, sessionId, describeAcpError(error), {
      ...data,
      visibleInTranscript: false,
    });
  } else if (error instanceof AcpTimeoutError) {
    failWedgedAgent(ctx, sessionId, describeAcpError(error));
  } else {
    failTurn(ctx, sessionId, describeAcpError(error));
  }
}
