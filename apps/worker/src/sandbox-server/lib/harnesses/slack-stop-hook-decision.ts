import { asRecord, asString } from '@roomote/types';

export const FALLBACK_STOP_HOOK_REMINDER =
  'Before finalizing, post a terminal chat-visible reply for the current turn.';

export interface StopHookDecision {
  blocked: boolean;
  reason?: string;
}

/** What a hook that could not run or answer means: the turn may not end. */
export const BLOCKED_FALLBACK: StopHookDecision = {
  blocked: true,
  reason: FALLBACK_STOP_HOOK_REMINDER,
};

/**
 * Reads the hook script's stdout. Empty output lets the turn end; a block
 * decision (any of the shapes the script may print) carries its reason;
 * output that is not JSON blocks.
 */
export function parseStopHookOutput(
  stdout: string,
  logger: { error: (message: string) => void },
  label: string,
): StopHookDecision {
  const trimmed = stdout.trim();

  if (trimmed.length === 0) {
    return { blocked: false };
  }

  let payload: Record<string, unknown> | undefined;

  try {
    payload = asRecord(JSON.parse(trimmed));
  } catch {
    logger.error(
      `${label} Slack stop hook returned invalid JSON stdout=${trimmed}`,
    );
    return BLOCKED_FALLBACK;
  }

  const blocked =
    payload?.decision === 'block' ||
    payload?.continue === false ||
    typeof payload?.stopReason === 'string';

  if (!payload || !blocked) {
    return { blocked: false };
  }

  return {
    blocked: true,
    reason:
      asString(payload.reason) ??
      asString(payload.stopReason) ??
      asString(asRecord(payload.hookSpecificOutput)?.additionalContext) ??
      FALLBACK_STOP_HOOK_REMINDER,
  };
}
