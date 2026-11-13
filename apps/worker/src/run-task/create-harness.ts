import type { ResultPromise } from 'execa';

import { type DequeuedTaskRun, sdk } from '@roomote/sdk/client';
import {
  buildTaskModelRoleOverrideEnv,
  getHarnessModelOverride,
  isReasoningEffort,
  isPrReviewRun,
  TASK_MODEL_ROLE_DESCRIPTORS,
  type EnvironmentMcpServers,
  type LaunchCodingHarness,
} from '@roomote/types';

import {
  type Harness,
  startCursorAcpHarness,
  startOpenCodeServerHarness,
} from '../sandbox-server';
import {
  type IntegrationMcpOptions,
  resolveBuiltInMcpServers,
} from '../commands/setup/setup-mcps';
import {
  onTaskSecretsAdded,
  recordTaskSecrets,
  taskSecretValues,
  useMaskSecretsFile,
} from '../lib/task-secrets';
import type { HarnessLogger } from '../logging';

import { captureWorkerException } from '../monitoring/sentry';

import type { RunTaskCallbacks, RunTaskContext } from './types';
import { buildHarnessCommandEnv } from './harnesses';
import { buildAgentFallbacks } from './agent-fallbacks';
import type { ReplayPrompt } from './engine-handoff';
import { prepareEngineSwitch, readHandoffInstructions } from './engine-switch';
import {
  type HarnessEngine,
  resolveHarnessEngine,
  resolveSessionResume,
} from './harness-engine';
import { createDiagnosticEventRecorder } from './diagnostic-events';
import { ReconnectableHarness } from './reconnectable-harness';
import { subscribeHarnessCallbacks } from './subscribe-harness-callbacks';

interface CreateHarnessOptions {
  harnessType: LaunchCodingHarness;
  workspacePath: string;
  runtimeEnv: Record<string, string>;
  harnessSessionId: string | undefined;
  cancelSignal: AbortSignal;
  integrations: IntegrationMcpOptions;
  mcpTaskEnv: Record<string, string>;
  environmentMcpServers?: EnvironmentMcpServers;
  /**
   * Deployment-scoped custom stdio MCP servers, fetched once at task start.
   * Merged after environment servers, so an environment entry with the same
   * name wins.
   */
  deploymentMcpServers?: EnvironmentMcpServers;
  /**
   * Operator-defined deployment env vars. Always eligible for ${...}
   * substitution in custom MCP config, regardless of variable name.
   */
  operatorEnvVars?: Record<string, string>;
  taskRun: DequeuedTaskRun['taskRun'];
  userAttentionNotificationsEnabled?: boolean;
  developerInstructionsContent?: string;
  callbacks: RunTaskCallbacks;
  context: RunTaskContext;
  logger: HarnessLogger;
  prepareQueuedPromptActorScope?: (
    targetUserId?: string,
    delivery?: {
      kind: 'queuedPrompt' | 'userInputAnswer';
      clientMessageId?: string;
    },
  ) => Promise<{
    shouldReconnect: boolean;
    shouldBlockPrompt?: boolean;
    shouldSkipPrompt?: boolean;
    reason?: string;
  }>;
}

interface CreateHarnessResult {
  harness: Harness;
  getSubprocess: () => ResultPromise | null;
  /** Unsubscribe from message/envelope event subscriptions. */
  unsubscribe: () => Promise<void>;
  /** Deliver the turn's closing assistant message before idle settlement. */
  flushPendingCompletionEvents: () => Promise<void>;
}

export async function createHarness({
  harnessType,
  workspacePath,
  runtimeEnv,
  harnessSessionId,
  cancelSignal,
  integrations,
  mcpTaskEnv,
  environmentMcpServers,
  deploymentMcpServers,
  operatorEnvVars,
  taskRun,
  userAttentionNotificationsEnabled,
  developerInstructionsContent,
  callbacks,
  context,
  logger,
  prepareQueuedPromptActorScope,
}: CreateHarnessOptions): Promise<CreateHarnessResult> {
  const stampHarnessStarted = () => {
    // Best-effort: do not derail task startup on telemetry failures.
    void sdk.taskRuns
      .stampMilestone({
        runId: taskRun.id,
        field: 'harnessStartedAt',
      })
      .catch(() => {});
  };

  const diagnosticEvents = createDiagnosticEventRecorder({
    runId: taskRun.id,
    logger,
  });

  /** The engine whose switch note the transcript already shows. */
  let announcedSwitchTo: string | undefined;

  /**
   * The engine that last started successfully. A session id says which engine
   * made it, but an engine that never stored one (a Cursor session that could
   * not be created) leaves nothing else to tell the next spawn that the work
   * came from the other engine. A start that threw never counts.
   */
  let lastStartedEngine: HarnessEngine['kind'] | undefined;

  /**
   * Fallbacks the Cursor harness already requested, across its respawns: a
   * respawn is how a fallback takes effect, and a fallback that fails to apply
   * must not be requested again by the harness that replaces the old one.
   */
  const fallbackAttempts = new Set<string>();

  const spawnHarness = async (options?: {
    initialSessionId?: string;
    replayPrompt?: ReplayPrompt;
  }): Promise<{ harness: Harness; subprocess: ResultPromise }> => {
    // The full runtime env, source-control tokens included: the spawn env
    // below drops them, but the agent's shells re-source them, so the agent
    // can still see (and be asked to repeat) their values. Every secret the
    // task has had (also those a reload added since the last spawn) goes to
    // the Cursor agent's own output masking, which cannot hide a secret from
    // its model.
    recordTaskSecrets(runtimeEnv);
    const secretValues = taskSecretValues();
    const modelOverride = taskRun.payload?.harnessModelOverrides
      ? getHarnessModelOverride(
          taskRun.payload.harnessModelOverrides,
          harnessType,
        )
      : undefined;
    // Per-task reasoning effort stamped at launch (or set explicitly via the
    // public API). Applied to the effective coding model, which per-role env
    // levels do not cover when a launch-time model override is in play.
    const reasoningEffortOverride = isReasoningEffort(
      taskRun.payload?.reasoningEffort,
    )
      ? taskRun.payload.reasoningEffort
      : undefined;
    // Read at every spawn (not just the first) so a config-update restart
    // regenerates the OpenCode config from the task's current overrides.
    const modelRoleOverrideEnv = buildTaskModelRoleOverrideEnv(
      taskRun.payload?.modelRoleOverrides,
    );
    // Built from `runtimeEnv` at every spawn, not once: run-task refreshes its
    // model-provider entries when a model switch moves the task to another
    // provider, and the respawn must start with that provider's key.
    const harnessCommandEnv = buildHarnessCommandEnv(runtimeEnv);
    const spawnRuntimeEnv =
      Object.keys(modelRoleOverrideEnv).length > 0
        ? { ...harnessCommandEnv, ...modelRoleOverrideEnv }
        : harnessCommandEnv;
    const fallbackRole = isPrReviewRun(taskRun)
      ? ('codeReview' as const)
      : ('coding' as const);
    const fallbackDescriptor = TASK_MODEL_ROLE_DESCRIPTORS[fallbackRole];
    const fallbackModel =
      spawnRuntimeEnv[fallbackDescriptor.fallbackModelEnvVar];
    const fallbackReasoningEffortValue =
      spawnRuntimeEnv[fallbackDescriptor.fallbackReasoningEnvVar];
    const fallbackReasoningEffort = isReasoningEffort(
      fallbackReasoningEffortValue,
    )
      ? fallbackReasoningEffortValue
      : undefined;
    // Subagent roles left at "Same as coding" have no role model env var; the
    // generated OpenCode agents then run on the effective coding model.
    const effectiveCodingModel =
      modelOverride ??
      spawnRuntimeEnv[TASK_MODEL_ROLE_DESCRIPTORS.coding.modelEnvVar];
    const agentFallbacks = buildAgentFallbacks(
      spawnRuntimeEnv,
      effectiveCodingModel,
    );

    // Decided on every spawn: a model fallback mutates the task payload and
    // reconnects, and the next spawn must run on whichever engine now serves
    // the coding model. A session id never crosses engines.
    const engine = resolveHarnessEngine(effectiveCodingModel);
    // Only a Cursor task has the Roomote MCP server mask or refuse the values of
    // its secrets (OpenCode has its own plugin), and the file it reads them
    // from must exist before the agent starts that server.
    const masksSecrets = engine.kind === 'cursor-acp';
    await useMaskSecretsFile(masksSecrets);
    const resolvedMcps = resolveBuiltInMcpServers(
      mcpTaskEnv,
      integrations,
      environmentMcpServers,
      operatorEnvVars,
      deploymentMcpServers,
      { maskSecretValues: masksSecrets },
    );
    const requestedSessionId = options?.initialSessionId ?? harnessSessionId;
    const resume = resolveSessionResume(
      engine,
      requestedSessionId,
      lastStartedEngine,
    );
    const handoffInstructions =
      resume.switchedFrom && taskRun.taskId
        ? await prepareEngineSwitch({
            runId: taskRun.id,
            taskId: taskRun.taskId,
            from: resume.switchedFrom,
            to: engine.kind,
            previousSessionId: requestedSessionId ?? '',
            announce: announcedSwitchTo !== engine.kind,
            replayPrompt: options?.replayPrompt,
            logger,
          })
        : undefined;
    if (resume.switchedFrom) {
      announcedSwitchTo = engine.kind;
    }
    // Cursor has no system channel, so its standing instructions and the
    // handoff travel together in the first prompt. OpenCode's system
    // instructions are rewritten at every spawn, so a handoff there would be
    // lost on its next respawn; it is handed over separately and becomes part
    // of the new OpenCode session's own history.
    const instructions = [
      developerInstructionsContent,
      engine.kind === 'cursor-acp' ? handoffInstructions : undefined,
    ]
      .filter(Boolean)
      .join('\n\n');
    const commonOptions = {
      workspacePath,
      runtimeEnv: spawnRuntimeEnv,
      cancelSignal,
      logger,
      mcpServers: resolvedMcps,
      initialSessionId: resume.sessionId,
      beforeQueuedPrompt: prepareQueuedPromptActorScope
        ? async ({
            userId,
            clientMessageId,
            kind,
          }: {
            userId?: string;
            clientMessageId?: string;
            kind: 'queuedPrompt' | 'userInputAnswer';
          }) =>
            await prepareQueuedPromptActorScope(userId, {
              kind,
              clientMessageId,
            })
        : undefined,
      ...(fallbackModel
        ? {
            fallbackModel,
            fallbackReasoningEffort,
            fallbackRole,
            // The model that is running. On Cursor that is the effective
            // coding model, whatever role (a PR review's code review model
            // included) the fallback is configured under.
            activeModelId:
              engine.kind === 'cursor-acp'
                ? effectiveCodingModel
                : (modelOverride ??
                  spawnRuntimeEnv[fallbackDescriptor.modelEnvVar]),
          }
        : {}),
    };

    const started =
      engine.kind === 'cursor-acp'
        ? await startCursorAcpHarness({
            ...commonOptions,
            secretValues,
            fallbackAttempts,
            // A session that could not be restored continues the task as the
            // engine switch does: from what the transcript says so far.
            restoreContext: (replayPrompt) =>
              readHandoffInstructions({
                runId: taskRun.id,
                from: engine.kind,
                replayPrompt,
                logger,
              }),
            modelOverride: engine.agentModel,
            developerInstructionsContent: instructions || undefined,
          })
        : await startOpenCodeServerHarness({
            ...commonOptions,
            handoffContext: handoffInstructions,
            ...(modelOverride ? { modelOverride } : {}),
            ...(reasoningEffortOverride ? { reasoningEffortOverride } : {}),
            ...(Object.keys(agentFallbacks).length > 0
              ? { agentFallbacks }
              : {}),
            developerInstructionsContent: instructions || undefined,
            onDiagnostic: (input) => {
              diagnosticEvents.record(input);
            },
            onUnexpectedExit: (certificate) => {
              const summary = `OpenCode server exited unexpectedly (code=${
                certificate.exitCode ?? 'none'
              }, signal=${certificate.signal ?? 'none'}) after ${Math.round(
                certificate.uptimeMs / 1000,
              )}s`;

              diagnosticEvents.record({
                kind: 'opencode_unexpected_exit',
                message: summary,
                details: {
                  exitCode: certificate.exitCode,
                  signal: certificate.signal,
                  uptimeMs: certificate.uptimeMs,
                  memoryAfterExit: certificate.memoryAfterExit,
                  outputTail: certificate.outputTail,
                },
              });
              captureWorkerException(new Error(summary), {
                runId: taskRun.id,
                taskId: taskRun.taskId ?? undefined,
                component: 'createHarness',
                stage: 'opencode_unexpected_exit',
                exitCode: certificate.exitCode,
                signal: certificate.signal,
                uptimeMs: certificate.uptimeMs,
              });
            },
          });

    lastStartedEngine = engine.kind;
    return started;
  };

  const reconnectableHarness = new ReconnectableHarness({
    logger,
    spawnHarness,
    diagnosticEvents,
  });
  await reconnectableHarness.start({ initialSessionId: harnessSessionId });
  stampHarnessStarted();

  // A secret that reaches the task after this point (a rotated source-control
  // token, a variable added mid-task) is masked by the live harness from then on.
  const stopSecretSync = onTaskSecretsAdded((values) =>
    reconnectableHarness.addSecretValues(values),
  );
  const unsubscribeCallbacks = subscribeHarnessCallbacks({
    harness: reconnectableHarness,
    taskRun,
    userAttentionNotificationsEnabled,
    callbacks,
    context,
    logger,
    mcpTaskEnv,
  });

  return {
    harness: reconnectableHarness,
    getSubprocess: () => reconnectableHarness.getCurrentSubprocess(),
    unsubscribe: async () => {
      stopSecretSync();
      await unsubscribeCallbacks();
    },
    flushPendingCompletionEvents:
      unsubscribeCallbacks.flushPendingCompletionEvents,
  };
}
