import { describeAcpError } from './acp-error-detail';
import { AcpTimeoutError } from './acp-rpc-error';
import { failTurn, failWedgedAgent } from './fail-turn';
import { newPlaceholderSessionId } from './placeholder-session';
import { isCursorQuotaError } from './quota-classifier';
import { failForQuota } from './quota-failure';
import { announceSession } from './session-announce';
import type { TurnContext } from './turn-context';
import type { PromptData } from './turn-state';

/**
 * Reports a session-start failure under `sessionId`. Returns false for an
 * error with no special handling, which the caller decides about.
 */
function reportKnownFailure(
  ctx: TurnContext,
  sessionId: string,
  error: unknown,
  prompt: PromptData,
): boolean {
  const detail = describeAcpError(error);

  if (isCursorQuotaError(error)) {
    failForQuota(ctx, sessionId, detail, prompt);
  } else if (error instanceof AcpTimeoutError) {
    failWedgedAgent(ctx, sessionId, detail);
  } else {
    return false;
  }

  return true;
}

/**
 * Reports a session-start failure and ends the task with it, so a prompt that
 * could not start never leaves the task looking busy. Reported under the
 * current session when there is one; otherwise under a throwaway id, announced
 * first because the manager only accepts events under an id it was told about,
 * which names no real session and is never resumed.
 */
export function failSessionStart(
  ctx: TurnContext,
  error: unknown,
  prompt: PromptData,
): void {
  const sessionId = ctx.session.id ?? newPlaceholderSessionId();

  announceSession(ctx, sessionId);

  if (!reportKnownFailure(ctx, sessionId, error, prompt)) {
    failTurn(
      ctx,
      sessionId,
      `Starting the Cursor agent session failed: ${describeAcpError(error)}`,
    );
  }
}
