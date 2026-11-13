import {
  MODEL_FALLBACK_AGENT_ROLES,
  TASK_MODEL_ROLE_DESCRIPTORS,
  isCursorTaskModelId,
  isReasoningEffort,
  type ReasoningEffort,
} from '@roomote/types';

type AgentFallback = {
  role: (typeof MODEL_FALLBACK_AGENT_ROLES)[keyof typeof MODEL_FALLBACK_AGENT_ROLES];
  activeModelId: string;
  fallbackModel: string;
  fallbackReasoningEffort?: ReasoningEffort;
};

/**
 * Per-subagent model fallbacks for the OpenCode harness. A subagent role left
 * at "Same as coding" runs on the effective coding model, except when that is
 * a Cursor model: OpenCode cannot run it, so the role has no active model and
 * gets no fallback, as if coding were unset.
 */
export function buildAgentFallbacks(
  runtimeEnv: Record<string, string>,
  effectiveCodingModel: string | undefined,
): Record<string, AgentFallback> {
  return Object.fromEntries(
    Object.entries(MODEL_FALLBACK_AGENT_ROLES).flatMap(([agentType, role]) => {
      const descriptor = TASK_MODEL_ROLE_DESCRIPTORS[role];
      const activeModelId = [
        runtimeEnv[descriptor.modelEnvVar],
        descriptor.modelFallback === 'coding'
          ? effectiveCodingModel
          : undefined,
      ].find((modelId) => modelId && !isCursorTaskModelId(modelId));
      const fallbackModel = runtimeEnv[descriptor.fallbackModelEnvVar];
      const effort = runtimeEnv[descriptor.fallbackReasoningEnvVar];

      return activeModelId &&
        fallbackModel &&
        !isCursorTaskModelId(fallbackModel) &&
        activeModelId !== fallbackModel
        ? [
            [
              agentType,
              {
                role,
                activeModelId,
                fallbackModel,
                ...(isReasoningEffort(effort)
                  ? { fallbackReasoningEffort: effort }
                  : {}),
              },
            ],
          ]
        : [];
    }),
  );
}
