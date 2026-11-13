import {
  ignoreCursorModel,
  withoutCursorRoleModels,
} from '@roomote/cloud-agents';
import {
  TASK_MODEL_ROLE_DESCRIPTORS,
  isCursorTaskModelId,
} from '@roomote/types';

const CODING = TASK_MODEL_ROLE_DESCRIPTORS.coding;

/**
 * OpenCode cannot run a Cursor model, so no `cursor/` id may reach its
 * config. Cursor role models (and fallbacks) are removed from the env in
 * place. When that empties the coding role, it runs on the per-task override
 * (the fallback model after a Cursor to OpenCode switch) or else on the
 * configured coding fallback; with neither there is nothing to run, which is
 * an error. Returns the override with a Cursor id dropped.
 */
export function stripCursorModelsForOpenCode(
  runtimeEnv: Record<string, string>,
  modelOverride: string | undefined,
): string | undefined {
  const override = ignoreCursorModel(modelOverride);
  const codingWasCursor = isCursorTaskModelId(runtimeEnv[CODING.modelEnvVar]);
  const sanitized = withoutCursorRoleModels(runtimeEnv);

  for (const name of Object.keys(runtimeEnv)) {
    if (!(name in sanitized)) {
      delete runtimeEnv[name];
    }
  }

  if (!codingWasCursor) {
    return override;
  }

  // The Cursor model's reasoning level does not describe its replacement.
  delete runtimeEnv[CODING.reasoningEnvVar];
  const fallback = runtimeEnv[CODING.fallbackModelEnvVar];
  const replacement = override ?? fallback;

  if (!replacement) {
    throw new Error(
      'The coding model is a Cursor model, which OpenCode cannot run, and no non-Cursor fallback model is configured.',
    );
  }

  runtimeEnv[CODING.modelEnvVar] = replacement;

  const fallbackEffort = runtimeEnv[CODING.fallbackReasoningEnvVar];

  if (!override && fallbackEffort) {
    runtimeEnv[CODING.reasoningEnvVar] = fallbackEffort;
  }

  return override;
}
