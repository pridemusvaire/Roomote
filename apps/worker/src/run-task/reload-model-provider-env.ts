import type { WorkerEnv } from '../env';
import {
  runUnlessCredentialWriteBarrier,
  waitForCredentialWriteBarrierRelease,
} from '../lib';
import type { HarnessLogger } from '../logging';
import { applyDeploymentEnvVarsReload } from '../sandbox-server/procedures/reloadDeploymentEnvVars';
import type { Harness } from '../sandbox-server';

import { applyFreshModelProviderEnv } from './apply-fresh-model-provider-env';

/**
 * `snapshot`: a snapshot holds the credential write barrier, so the env is
 * still the old one and cannot be refreshed until the barrier is released.
 */
export type ModelEnvReload = 'reloaded' | 'failed' | 'snapshot';

/**
 * A harness reads its env when it spawns, so a model switch that moves the
 * task to another provider (OpenCode to Cursor, say) must refresh that env
 * first. Never throws: if the reload fails the restart goes ahead, and a
 * missing key then fails loudly at the harness instead of silently here.
 * While a snapshot holds the barrier a restart would only fail with a
 * misleading "key is not set", so the caller learns of it (`snapshot`) or,
 * with `waitForSnapshot`, waits for the barrier to be released. That wait
 * ends when its `signal` aborts (the task is cancelled, or the caller's
 * deadline passed), and the result is `snapshot` again.
 */
export function createModelProviderEnvReloader(deps: {
  runId: number;
  workerEnv: WorkerEnv;
  /** The object `createHarness` builds every spawn's env from. */
  runtimeEnv: Record<string, string>;
  getHarness: () => Harness;
  logger: HarnessLogger;
}): (options?: {
  waitForSnapshot?: { signal: AbortSignal };
}) => Promise<ModelEnvReload> {
  const { runId, workerEnv, runtimeEnv, getHarness, logger } = deps;

  return async (options) => {
    try {
      for (;;) {
        // env.sh is rewritten, which must not happen mid-snapshot.
        const reloaded = await runUnlessCredentialWriteBarrier(() =>
          applyDeploymentEnvVarsReload({
            runId,
            workerEnv,
            harness: getHarness(),
          }),
        );

        if (reloaded) {
          applyFreshModelProviderEnv(runtimeEnv, reloaded.envVars);
          return 'reloaded';
        }

        logger.warn(
          '[runTask] Skipped the model provider env reload: a snapshot is being prepared',
        );

        const signal = options?.waitForSnapshot?.signal;

        if (!signal) {
          return 'snapshot';
        }

        if (!(await waitForCredentialWriteBarrierRelease(signal))) {
          return 'snapshot';
        }
      }
    } catch (error) {
      logger.warn(
        `[runTask] Failed to reload the model provider env: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return 'failed';
    }
  };
}
