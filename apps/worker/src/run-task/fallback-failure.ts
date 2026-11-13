import { isCursorTaskModelId } from '@roomote/types';

import type { Harness } from '../sandbox-server/lib/harness';
import type { ModelFallbackRequest } from '../sandbox-server/lib/harnesses/cursor-acp/harness-options';

import { buildFallbackRecoveryCommand } from './fallback-recovery';

export const describeError = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

/**
 * What to do when serving a model fallback threw. A switch that was never
 * persisted leaves a Cursor task on the model that ran out, so it ends with
 * the reason; any other task carries on as it was. If even the restart throws
 * there is no harness left to answer anything, so that ends the task too,
 * with a message, instead of leaving it hung.
 */
export async function recoverFromFailedFallback(input: {
  harness: Harness;
  request: ModelFallbackRequest;
  persisted: boolean;
  error: unknown;
}): Promise<void> {
  const { harness, request, persisted, error } = input;

  if (
    !persisted &&
    isCursorTaskModelId(request.fromModelId) &&
    harness.failTask
  ) {
    harness.failTask(
      `Cursor plan limit reached, and switching to ${request.toModelId} failed (${describeError(error)}). Pick another model for this task and send your message again.`,
    );
    return;
  }

  try {
    await harness.requestReconnect?.({
      reason: 'Recovering after model fallback failed to persist',
      replayCommands: [
        buildFallbackRecoveryCommand({ ...request, agentType: undefined }),
      ],
    });
  } catch (reconnectError) {
    harness.failTask?.(
      `Switching to ${request.toModelId} failed, and the agent could not be restarted (${describeError(reconnectError)}). Send your message again.`,
    );
  }
}
