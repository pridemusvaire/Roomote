import {
  getHarnessModelOverride,
  TASK_MODEL_OVERRIDE_ROLES,
  type HarnessModelOverrides,
  type TaskModelRoleOverrides,
} from './task-runs';

/**
 * The models a task run itself selected, beyond the deployment's role models:
 * the coding model override (a launch-time choice, a routing rule, or a switch
 * mid-run) and every per-role override. Provider credentials are resolved from
 * these as well, so a task on another provider's model gets that provider's
 * key and no task gets a key for a provider it does not use.
 */
export function getTaskPayloadModelIds(
  payload:
    | {
        harnessModelOverrides?: HarnessModelOverrides | null;
        modelRoleOverrides?: TaskModelRoleOverrides | null;
      }
    | null
    | undefined,
): string[] {
  const roleModels = TASK_MODEL_OVERRIDE_ROLES.map(
    (role) => payload?.modelRoleOverrides?.[role]?.model?.trim() || undefined,
  );
  const ids = [
    getHarnessModelOverride(payload?.harnessModelOverrides, 'opencode-server'),
    ...roleModels,
  ];

  return [...new Set(ids.filter((id): id is string => Boolean(id)))];
}
