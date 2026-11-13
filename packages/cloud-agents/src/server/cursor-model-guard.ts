import {
  TASK_MODEL_ROLES,
  TASK_MODEL_ROLE_DESCRIPTORS,
  isCursorTaskModelId,
} from '@roomote/types';

/**
 * Cursor models run on Cursor's own agent, which only a task's coding role
 * can use. Everything that hands a model to OpenCode (non-task helpers, the
 * fast agent) must treat a `cursor/` id as unset so the role falls back to its
 * own model, its fallback, or the deployment default.
 */
export function ignoreCursorModel(
  modelId: string | undefined,
): string | undefined {
  return isCursorTaskModelId(modelId) ? undefined : modelId;
}

const ROLE_MODEL_ENV_VAR_NAMES = TASK_MODEL_ROLES.flatMap((role) => {
  const descriptor = TASK_MODEL_ROLE_DESCRIPTORS[role];
  return [descriptor.modelEnvVar, descriptor.fallbackModelEnvVar];
});

/** True when any role model (or role fallback) in the env is a Cursor model. */
export function hasCursorRoleModel(
  env: Partial<Record<string, string | undefined>>,
): boolean {
  return ROLE_MODEL_ENV_VAR_NAMES.some((name) =>
    isCursorTaskModelId(env[name]),
  );
}

/** A copy of the env with every Cursor role model (and fallback) removed. */
export function withoutCursorRoleModels<
  T extends Partial<Record<string, string | undefined>>,
>(env: T): T {
  const next = { ...env };

  for (const name of ROLE_MODEL_ENV_VAR_NAMES) {
    if (isCursorTaskModelId(next[name])) {
      delete next[name];
    }
  }

  return next;
}
