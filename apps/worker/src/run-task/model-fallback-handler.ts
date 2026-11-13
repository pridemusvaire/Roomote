import type { DequeuedTaskRun } from '@roomote/sdk/client';
import type { HarnessLogger } from '../logging';
import type { Harness } from '../sandbox-server/lib/harness';
import type { ModelFallbackRequest } from '../sandbox-server/lib/harnesses/cursor-acp/harness-options';

import { buildFallbackRecoveryCommand } from './fallback-recovery';
import { describeError, recoverFromFailedFallback } from './fallback-failure';
import { persistModelFallback } from './persist-model-fallback';
import type { ModelEnvReload } from './reload-model-provider-env';

/** Longest the switch waits for a snapshot in progress before ending the task. */
const SNAPSHOT_WAIT_MS = 5 * 60_000;

/**
 * Serves a harness's `modelFallbackRequested`: persists the switch, reloads
 * the run payload and provider keys so the respawn picks up the new model, reconnects, then
 * tells the agent to carry on. If persisting fails an OpenCode agent carries
 * on as it was. A Cursor plan limit cannot: the model did not change, so the
 * respawn would hit the same limit, and the task ends with the reason instead.
 */
export function createModelFallbackHandler(deps: {
  harness: Harness;
  taskRun: DequeuedTaskRun['taskRun'];
  logger: HarnessLogger;
  /**
   * Refreshes the provider keys the respawned harness starts with. Resolves
   * once they are fresh (after a snapshot's credential barrier, if one was
   * in the way), so the respawn never starts without its key.
   */
  reloadModelProviderEnv: (options: {
    waitForSnapshot: { signal: AbortSignal };
  }) => Promise<ModelEnvReload>;
  /** Aborts when the task is cancelled; the switch has nothing left to do. */
  cancelSignal: AbortSignal;
  /** How long to wait for a snapshot in progress. */
  snapshotWaitMs?: number;
}): (request: ModelFallbackRequest) => Promise<void> {
  const { harness, taskRun, logger, reloadModelProviderEnv, cancelSignal } =
    deps;
  const snapshotWaitMs = deps.snapshotWaitMs ?? SNAPSHOT_WAIT_MS;

  return async (request) => {
    let persisted = false;

    try {
      if (request.role === 'orchestration') return;
      await persistModelFallback(taskRun, request, request.role);
      persisted = true;
      // The fallback model may sit on a provider the task did not start with.
      // A snapshot in progress holds the env back, but not for ever: a task
      // that waits on it for good has no harness to answer a message or a stop.
      const reload = await reloadModelProviderEnv({
        waitForSnapshot: {
          signal: AbortSignal.any([
            cancelSignal,
            AbortSignal.timeout(snapshotWaitMs),
          ]),
        },
      });

      if (reload === 'snapshot') {
        if (!cancelSignal.aborted) {
          harness.failTask?.(
            `Switching to ${request.toModelId} did not finish: the sandbox was still preparing a snapshot. Send your message again to retry.`,
          );
        }

        return;
      }

      await harness.requestReconnect?.({
        reason: 'Switching to fallback model',
        replayCommands: [buildFallbackRecoveryCommand(request)],
      });
    } catch (error) {
      logger.error(
        `[runTask] Failed to apply model fallback: ${describeError(error)}`,
      );
      await recoverFromFailedFallback({ harness, request, persisted, error });
    }
  };
}
