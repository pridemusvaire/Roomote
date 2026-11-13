import { sdk, type DequeuedTaskRun } from '@roomote/sdk/client';

import type { ModelFallbackRequest } from '../sandbox-server/lib/harnesses/cursor-acp/harness-options';

/**
 * Stores the model switch for the run and reloads the run's payload, which the
 * respawned harness reads its model from.
 */
export async function persistModelFallback(
  taskRun: DequeuedTaskRun['taskRun'],
  request: ModelFallbackRequest,
  /** The request's role, once the caller has ruled out orchestration. */
  role: Exclude<ModelFallbackRequest['role'], 'orchestration'>,
): Promise<void> {
  await sdk.taskRuns.applyModelFallback({
    runId: taskRun.id,
    taskId: taskRun.taskId,
    role,
    fromModelId: request.fromModelId,
    toModelId: request.toModelId,
    toReasoningEffort: request.toReasoningEffort,
    errorSummary: request.errorSummary,
    trigger: request.trigger,
    ...(request.sessionId ? { sessionId: request.sessionId } : {}),
  });

  const freshRun = await sdk.taskRuns.findFirstById(taskRun.id);

  if (freshRun?.payload && typeof freshRun.payload === 'object') {
    taskRun.payload = freshRun.payload;
  }
}
